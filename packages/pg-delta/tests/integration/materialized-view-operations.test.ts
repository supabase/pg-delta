/**
 * Integration tests for PostgreSQL materialized view operations.
 */

import { describe, expect, test } from "bun:test";
import dedent from "dedent";
import { createPlan } from "../../src/core/plan/create.ts";
import { flattenPlanStatements } from "../../src/core/plan/render.ts";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { withDb, withDbIsolated } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`materialized view operations (pg${pgVersion})`, () => {
    test(
      "create new materialized view",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.users (
            id integer PRIMARY KEY,
            name text NOT NULL,
            email text,
            active boolean DEFAULT true
          );
        `,
          testSql: dedent`
          CREATE MATERIALIZED VIEW test_schema.active_users AS
          SELECT id, name, email
          FROM test_schema.users
          WHERE active = true
          WITH NO DATA;
        `,
        });
      }),
    );

    test(
      "drop existing materialized view",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.users (
            id integer PRIMARY KEY,
            name text NOT NULL,
            active boolean DEFAULT true
          );

          CREATE MATERIALIZED VIEW test_schema.active_users AS
          SELECT id, name
          FROM test_schema.users
          WHERE active = true
          WITH NO DATA;
        `,
          testSql: `
          DROP MATERIALIZED VIEW test_schema.active_users;
        `,
        });
      }),
    );

    test(
      "replace materialized view definition",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.users (
            id integer PRIMARY KEY,
            name text NOT NULL,
            email text,
            active boolean DEFAULT true
          );

          CREATE MATERIALIZED VIEW test_schema.user_summary AS
          SELECT id, name
          FROM test_schema.users
          WHERE active = true
          WITH NO DATA;
        `,
          testSql: dedent`
          DROP MATERIALIZED VIEW test_schema.user_summary;
          CREATE MATERIALIZED VIEW test_schema.user_summary AS
          SELECT id, name, email
          FROM test_schema.users
          WHERE active = true
          ORDER BY name
          WITH NO DATA;
        `,
        });
      }),
    );

    test(
      "replace materialized view with dependent index and view",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE SCHEMA test_schema;

            CREATE TABLE test_schema.orders (
              id serial PRIMARY KEY,
              customer text NOT NULL,
              total numeric NOT NULL,
              created_at timestamptz DEFAULT now()
            );

            CREATE MATERIALIZED VIEW test_schema.order_summary AS
              SELECT customer, sum(total) AS total_spent, count(*) AS order_count
              FROM test_schema.orders
              GROUP BY customer;

            CREATE UNIQUE INDEX order_summary_customer_idx
              ON test_schema.order_summary (customer);

            CREATE VIEW test_schema.top_customers AS
              SELECT * FROM test_schema.order_summary
              WHERE total_spent > 1000;
          `,
          testSql: dedent`
            DROP VIEW test_schema.top_customers;
            DROP INDEX test_schema.order_summary_customer_idx;
            DROP MATERIALIZED VIEW test_schema.order_summary;

            CREATE MATERIALIZED VIEW test_schema.order_summary AS
              SELECT customer,
                     sum(total) AS total_spent,
                     count(*) AS order_count,
                     max(created_at) AS last_order
              FROM test_schema.orders
              GROUP BY customer;

            CREATE UNIQUE INDEX order_summary_customer_idx
              ON test_schema.order_summary (customer);

            CREATE VIEW test_schema.top_customers AS
              SELECT * FROM test_schema.order_summary
              WHERE total_spent > 1000;
          `,
          assertSqlStatements: (statements) => {
            // Invariant: the dependent index and view must be dropped before
            // the materialized view, and recreated after it. Exact SQL body
            // varies between PG versions (pg_get_viewdef / pg_get_mvdef
            // qualifies column references with the relation name on PG15 but
            // not on PG17+), so this test pins cascade order and the set of
            // touched objects rather than byte-for-byte SQL.
            const indexOf = (pattern: RegExp) =>
              statements.findIndex((s) => pattern.test(s));

            const dropIndexIdx = indexOf(
              /^DROP INDEX\s+test_schema\.order_summary_customer_idx\b/i,
            );
            const dropViewIdx = indexOf(
              /^DROP VIEW\s+test_schema\.top_customers\b/i,
            );
            const dropMatviewIdx = indexOf(
              /^DROP MATERIALIZED VIEW\s+test_schema\.order_summary\b/i,
            );
            const createMatviewIdx = indexOf(
              /^CREATE MATERIALIZED VIEW\s+test_schema\.order_summary\b/i,
            );
            const createIndexIdx = indexOf(
              /^CREATE UNIQUE INDEX\s+order_summary_customer_idx\s+ON\s+test_schema\.order_summary\b/i,
            );
            const createViewIdx = indexOf(
              /^CREATE(\s+OR\s+REPLACE)?\s+VIEW\s+test_schema\.top_customers\b/i,
            );

            expect(dropIndexIdx).toBeGreaterThanOrEqual(0);
            expect(dropViewIdx).toBeGreaterThanOrEqual(0);
            expect(dropMatviewIdx).toBeGreaterThanOrEqual(0);
            expect(createMatviewIdx).toBeGreaterThanOrEqual(0);
            expect(createIndexIdx).toBeGreaterThanOrEqual(0);
            expect(createViewIdx).toBeGreaterThanOrEqual(0);

            // Dependents must be dropped before the matview.
            expect(dropIndexIdx).toBeLessThan(dropMatviewIdx);
            expect(dropViewIdx).toBeLessThan(dropMatviewIdx);
            // Matview must be recreated before its dependents.
            expect(createMatviewIdx).toBeLessThan(createIndexIdx);
            expect(createMatviewIdx).toBeLessThan(createViewIdx);
            // The new column must be present in the recreated matview.
            expect(statements[createMatviewIdx]).toMatch(/last_order/);
          },
        });
      }),
    );

    test(
      "restore materialized view metadata when replacing for column type rewrite",
      withDbIsolated(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE ROLE test_matview_reader;

            CREATE SCHEMA test_schema;
            CREATE TABLE test_schema.users (
              id integer PRIMARY KEY,
              age numeric
            );

            CREATE MATERIALIZED VIEW test_schema.user_ages AS
              SELECT id, age
              FROM test_schema.users
              WHERE age > 0
              WITH NO DATA;

            COMMENT ON MATERIALIZED VIEW test_schema.user_ages
              IS 'user ages matview';

            GRANT SELECT ON test_schema.user_ages TO test_matview_reader;
          `,
          testSql: dedent`
            DROP MATERIALIZED VIEW test_schema.user_ages;

            ALTER TABLE test_schema.users
              ALTER COLUMN age TYPE integer USING age::integer;

            CREATE MATERIALIZED VIEW test_schema.user_ages AS
              SELECT id, age
              FROM test_schema.users
              WHERE age > 0
              WITH NO DATA;

            COMMENT ON MATERIALIZED VIEW test_schema.user_ages
              IS 'user ages matview';

            GRANT SELECT ON test_schema.user_ages TO test_matview_reader;
          `,
          assertSqlStatements: (statements) => {
            const dropMatviewIdx = statements.findIndex((statement) =>
              statement.includes(
                "DROP MATERIALIZED VIEW test_schema.user_ages",
              ),
            );
            const alterColumnIdx = statements.findIndex((statement) =>
              statement.includes(
                "ALTER TABLE test_schema.users ALTER COLUMN age TYPE integer",
              ),
            );
            const createMatviewIdx = statements.findIndex((statement) =>
              statement.includes(
                "CREATE MATERIALIZED VIEW test_schema.user_ages",
              ),
            );
            const commentMatviewIdx = statements.findIndex((statement) =>
              statement.includes(
                "COMMENT ON MATERIALIZED VIEW test_schema.user_ages",
              ),
            );
            const grantMatviewIdx = statements.findIndex((statement) =>
              statement.includes(
                "GRANT SELECT ON test_schema.user_ages TO test_matview_reader",
              ),
            );

            expect(dropMatviewIdx).toBeGreaterThanOrEqual(0);
            expect(alterColumnIdx).toBeGreaterThanOrEqual(0);
            expect(createMatviewIdx).toBeGreaterThanOrEqual(0);
            expect(commentMatviewIdx).toBeGreaterThanOrEqual(0);
            expect(grantMatviewIdx).toBeGreaterThanOrEqual(0);
            expect(dropMatviewIdx).toBeLessThan(alterColumnIdx);
            expect(alterColumnIdx).toBeLessThan(createMatviewIdx);
            expect(createMatviewIdx).toBeLessThan(commentMatviewIdx);
            expect(createMatviewIdx).toBeLessThan(grantMatviewIdx);
          },
        });
      }),
    );

    test(
      "materialized view with aggregations",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA analytics;
          CREATE TABLE analytics.sales (
            id integer PRIMARY KEY,
            customer_id integer,
            amount decimal(10,2),
            sale_date date
          );
        `,
          testSql: dedent`
          CREATE MATERIALIZED VIEW analytics.monthly_sales AS
          SELECT
            DATE_TRUNC('month', sale_date) as month,
            COUNT(*) as total_sales,
            SUM(amount) as total_revenue
          FROM analytics.sales
          GROUP BY DATE_TRUNC('month', sale_date)
          ORDER BY month
          WITH NO DATA;
        `,
        });
      }),
    );

    test(
      "materialized view with joins",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA ecommerce;
          CREATE TABLE ecommerce.customers (
            id integer PRIMARY KEY,
            name text NOT NULL
          );

          CREATE TABLE ecommerce.orders (
            id integer PRIMARY KEY,
            customer_id integer,
            total decimal(10,2)
          );
        `,
          testSql: `
          CREATE MATERIALIZED VIEW ecommerce.customer_orders AS
          SELECT
            c.id as customer_id,
            c.name,
            COUNT(o.id) as order_count,
            COALESCE(SUM(o.total), 0) as total_spent
          FROM ecommerce.customers c
          LEFT JOIN ecommerce.orders o ON c.id = o.customer_id
          GROUP BY c.id, c.name
          WITH NO DATA;
        `,
        });
      }),
    );

    test(
      "materialized view comments",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.users (
            id integer PRIMARY KEY,
            name text
          );
          CREATE MATERIALIZED VIEW test_schema.user_names AS
          SELECT id, name FROM test_schema.users WITH NO DATA;
        `,
          testSql: `
          COMMENT ON MATERIALIZED VIEW test_schema.user_names IS 'user names matview';
        `,
        });
      }),
    );

    test(
      "refresh materialized view does not trigger a diff",
      withDb(pgVersion, async (db) => {
        // Issue #133 acceptance: REFRESH MATERIALIZED VIEW changes data but not
        // the catalog, so pg-delta must generate an empty plan. If createPlan
        // returns null (identical catalogs), roundtripFidelityTest returns
        // early; otherwise the assertion below pins the generated statement
        // list to zero entries.
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE SCHEMA refresh_schema;
            CREATE TABLE refresh_schema.orders (
              id integer PRIMARY KEY,
              total numeric NOT NULL
            );
            INSERT INTO refresh_schema.orders (id, total)
              VALUES (1, 100), (2, 200);
            CREATE MATERIALIZED VIEW refresh_schema.totals AS
              SELECT sum(total) AS all_total FROM refresh_schema.orders;
          `,
          testSql: dedent`
            INSERT INTO refresh_schema.orders (id, total) VALUES (3, 300);
            REFRESH MATERIALIZED VIEW refresh_schema.totals;
          `,
          assertSqlStatements: (statements) => {
            expect(statements).toStrictEqual([]);
          },
        });
      }),
    );

    test(
      "semantically identical materialized view definition does not trigger a diff",
      withDb(pgVersion, async (db) => {
        const setup = dedent`
            CREATE TABLE public.recipe (
              id integer PRIMARY KEY,
              name text,
              notes text
            );

            CREATE MATERIALIZED VIEW IF NOT EXISTS public.recipe_search AS (
              WITH joined AS (
                SELECT recipe.id, name AS search_text FROM public.recipe WHERE name IS NOT NULL AND name != ''
                UNION
                SELECT recipe.id, notes FROM public.recipe WHERE notes IS NOT NULL AND notes != ''
              )

              SELECT
                id,
                search_text
              FROM joined
            );
          `;
        await db.main.query(setup);
        await db.branch.query(setup);

        await db.main.query("SET search_path = public");
        await db.branch.query("SET search_path = ''");

        const planResult = await createPlan(db.main, db.branch);
        const statements = planResult
          ? flattenPlanStatements(planResult.plan)
          : [];

        expect(statements).toStrictEqual([]);
      }),
    );
  });
}
