/**
 * Integration tests for PostgreSQL materialized view operations.
 */

import dedent from "dedent";
import { describe } from "vitest";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { getTest } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTest(pgVersion);

  describe.concurrent(`materialized view operations (pg${pgVersion})`, () => {
    test("create new materialized view", async ({ db }) => {
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
        description: "create new materialized view",
        expectedSqlTerms: [
          pgVersion === 15
            ? dedent`
              CREATE MATERIALIZED VIEW test_schema.active_users AS SELECT users.id,
                  users.name,
                  users.email
                 FROM test_schema.users
                WHERE (users.active = true)`
            : dedent`
              CREATE MATERIALIZED VIEW test_schema.active_users AS SELECT id,
                  name,
                  email
                 FROM test_schema.users
                WHERE (active = true)`,
        ],
        expectedMainDependencies: [
          {
            dependent_stable_id: "table:test_schema.users",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "constraint:test_schema.users.users_pkey",
            referenced_stable_id: "table:test_schema.users",
            deptype: "a",
          },
          {
            dependent_stable_id: "index:test_schema.users_pkey",
            referenced_stable_id: "constraint:test_schema.users.users_pkey",
            deptype: "i",
          },
        ],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "table:test_schema.users",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "constraint:test_schema.users.users_pkey",
            referenced_stable_id: "table:test_schema.users",
            deptype: "a",
          },
          {
            dependent_stable_id: "index:test_schema.users_pkey",
            referenced_stable_id: "constraint:test_schema.users.users_pkey",
            deptype: "i",
          },
          {
            dependent_stable_id: "materializedView:test_schema.active_users",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "materializedView:test_schema.active_users",
            referenced_stable_id: "table:test_schema.users",
            deptype: "n",
          },
        ],
      });
    });

    test("drop existing materialized view", async ({ db }) => {
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
        description: "drop existing materialized view",
        expectedSqlTerms: [`DROP MATERIALIZED VIEW test_schema.active_users`],
        expectedMainDependencies: [
          {
            dependent_stable_id: "table:test_schema.users",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "constraint:test_schema.users.users_pkey",
            referenced_stable_id: "table:test_schema.users",
            deptype: "a",
          },
          {
            dependent_stable_id: "index:test_schema.users_pkey",
            referenced_stable_id: "constraint:test_schema.users.users_pkey",
            deptype: "i",
          },
          {
            dependent_stable_id: "materializedView:test_schema.active_users",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "materializedView:test_schema.active_users",
            referenced_stable_id: "table:test_schema.users",
            deptype: "n",
          },
        ],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "table:test_schema.users",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "constraint:test_schema.users.users_pkey",
            referenced_stable_id: "table:test_schema.users",
            deptype: "a",
          },
          {
            dependent_stable_id: "index:test_schema.users_pkey",
            referenced_stable_id: "constraint:test_schema.users.users_pkey",
            deptype: "i",
          },
        ],
      });
    });

    test("replace materialized view definition", async ({ db }) => {
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
        description: "replace materialized view definition",
        expectedSqlTerms: [
          pgVersion === 15
            ? dedent`
              DROP MATERIALIZED VIEW test_schema.user_summary;
              CREATE MATERIALIZED VIEW test_schema.user_summary AS SELECT users.id,
                  users.name,
                  users.email
                 FROM test_schema.users
                WHERE (users.active = true)
                ORDER BY users.name`
            : dedent`
              DROP MATERIALIZED VIEW test_schema.user_summary;
              CREATE MATERIALIZED VIEW test_schema.user_summary AS SELECT id,
                  name,
                  email
                 FROM test_schema.users
                WHERE (active = true)
                ORDER BY name`,
        ],
        expectedMainDependencies: [
          {
            dependent_stable_id: "table:test_schema.users",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "constraint:test_schema.users.users_pkey",
            referenced_stable_id: "table:test_schema.users",
            deptype: "a",
          },
          {
            dependent_stable_id: "index:test_schema.users_pkey",
            referenced_stable_id: "constraint:test_schema.users.users_pkey",
            deptype: "i",
          },
          {
            dependent_stable_id: "materializedView:test_schema.user_summary",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "materializedView:test_schema.user_summary",
            referenced_stable_id: "table:test_schema.users",
            deptype: "n",
          },
        ],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "table:test_schema.users",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "constraint:test_schema.users.users_pkey",
            referenced_stable_id: "table:test_schema.users",
            deptype: "a",
          },
          {
            dependent_stable_id: "index:test_schema.users_pkey",
            referenced_stable_id: "constraint:test_schema.users.users_pkey",
            deptype: "i",
          },
          {
            dependent_stable_id: "materializedView:test_schema.user_summary",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "materializedView:test_schema.user_summary",
            referenced_stable_id: "table:test_schema.users",
            deptype: "n",
          },
        ],
      });
    });

    test("materialized view with aggregations", async ({ db }) => {
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
        description: "materialized view with aggregations",
        expectedSqlTerms: [
          pgVersion === 15
            ? dedent`
            CREATE MATERIALIZED VIEW analytics.monthly_sales AS SELECT date_trunc('month'::text, (sales.sale_date)::timestamp with time zone) AS month,
                count(*) AS total_sales,
                sum(sales.amount) AS total_revenue
               FROM analytics.sales
              GROUP BY (date_trunc('month'::text, (sales.sale_date)::timestamp with time zone))
              ORDER BY (date_trunc('month'::text, (sales.sale_date)::timestamp with time zone))`
            : dedent`
            CREATE MATERIALIZED VIEW analytics.monthly_sales AS SELECT date_trunc('month'::text, (sale_date)::timestamp with time zone) AS month,
                count(*) AS total_sales,
                sum(amount) AS total_revenue
               FROM analytics.sales
              GROUP BY (date_trunc('month'::text, (sale_date)::timestamp with time zone))
              ORDER BY (date_trunc('month'::text, (sale_date)::timestamp with time zone))`,
        ],
        expectedMainDependencies: [
          {
            dependent_stable_id: "table:analytics.sales",
            referenced_stable_id: "schema:analytics",
            deptype: "n",
          },
          {
            dependent_stable_id: "constraint:analytics.sales.sales_pkey",
            referenced_stable_id: "table:analytics.sales",
            deptype: "a",
          },
          {
            dependent_stable_id: "index:analytics.sales_pkey",
            referenced_stable_id: "constraint:analytics.sales.sales_pkey",
            deptype: "i",
          },
        ],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "table:analytics.sales",
            referenced_stable_id: "schema:analytics",
            deptype: "n",
          },
          {
            dependent_stable_id: "constraint:analytics.sales.sales_pkey",
            referenced_stable_id: "table:analytics.sales",
            deptype: "a",
          },
          {
            dependent_stable_id: "index:analytics.sales_pkey",
            referenced_stable_id: "constraint:analytics.sales.sales_pkey",
            deptype: "i",
          },
          {
            dependent_stable_id: "materializedView:analytics.monthly_sales",
            referenced_stable_id: "schema:analytics",
            deptype: "n",
          },
          {
            dependent_stable_id: "materializedView:analytics.monthly_sales",
            referenced_stable_id: "table:analytics.sales",
            deptype: "n",
          },
        ],
      });
    });

    test("materialized view with joins", async ({ db }) => {
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
        description: "materialized view with joins",
        expectedSqlTerms: [
          `CREATE MATERIALIZED VIEW ecommerce.customer_orders AS SELECT c.id AS customer_id,
    c.name,
    count(o.id) AS order_count,
    COALESCE(sum(o.total), (0)::numeric) AS total_spent
   FROM (ecommerce.customers c
     LEFT JOIN ecommerce.orders o ON ((c.id = o.customer_id)))
  GROUP BY c.id, c.name`,
        ],
        expectedMainDependencies: [
          {
            dependent_stable_id: "table:ecommerce.customers",
            referenced_stable_id: "schema:ecommerce",
            deptype: "n",
          },
          {
            dependent_stable_id:
              "constraint:ecommerce.customers.customers_pkey",
            referenced_stable_id: "table:ecommerce.customers",
            deptype: "a",
          },
          {
            dependent_stable_id: "index:ecommerce.customers_pkey",
            referenced_stable_id:
              "constraint:ecommerce.customers.customers_pkey",
            deptype: "i",
          },
          {
            dependent_stable_id: "table:ecommerce.orders",
            referenced_stable_id: "schema:ecommerce",
            deptype: "n",
          },
          {
            dependent_stable_id: "constraint:ecommerce.orders.orders_pkey",
            referenced_stable_id: "table:ecommerce.orders",
            deptype: "a",
          },
          {
            dependent_stable_id: "index:ecommerce.orders_pkey",
            referenced_stable_id: "constraint:ecommerce.orders.orders_pkey",
            deptype: "i",
          },
        ],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "table:ecommerce.customers",
            referenced_stable_id: "schema:ecommerce",
            deptype: "n",
          },
          {
            dependent_stable_id:
              "constraint:ecommerce.customers.customers_pkey",
            referenced_stable_id: "table:ecommerce.customers",
            deptype: "a",
          },
          {
            dependent_stable_id: "index:ecommerce.customers_pkey",
            referenced_stable_id:
              "constraint:ecommerce.customers.customers_pkey",
            deptype: "i",
          },
          {
            dependent_stable_id: "table:ecommerce.orders",
            referenced_stable_id: "schema:ecommerce",
            deptype: "n",
          },
          {
            dependent_stable_id: "constraint:ecommerce.orders.orders_pkey",
            referenced_stable_id: "table:ecommerce.orders",
            deptype: "a",
          },
          {
            dependent_stable_id: "index:ecommerce.orders_pkey",
            referenced_stable_id: "constraint:ecommerce.orders.orders_pkey",
            deptype: "i",
          },
          {
            dependent_stable_id: "materializedView:ecommerce.customer_orders",
            referenced_stable_id: "schema:ecommerce",
            deptype: "n",
          },
          {
            dependent_stable_id: "materializedView:ecommerce.customer_orders",
            referenced_stable_id: "table:ecommerce.customers",
            deptype: "n",
          },
          {
            dependent_stable_id: "materializedView:ecommerce.customer_orders",
            referenced_stable_id: "table:ecommerce.orders",
            deptype: "n",
          },
        ],
      });
    });
  });
}
