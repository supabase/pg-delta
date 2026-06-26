/**
 * Integration tests for PostgreSQL type operations.
 */

import { describe, expect, test } from "bun:test";
import dedent from "dedent";
import { extractCatalog } from "../../src/core/catalog.model.ts";
import type { Change } from "../../src/core/change.types.ts";
import { createPlan } from "../../src/core/plan/create.ts";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { withDb } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";
import { flattenPlanStatements } from "../../src/core/plan/render.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`type operations (pg${pgVersion})`, () => {
    test(
      "create enum type",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA test_schema;",
          testSql: `
          CREATE TYPE test_schema.mood AS ENUM ('sad', 'ok', 'happy');
        `,
        });
      }),
    );
    test(
      "add multiple leading enum values before the first existing value",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
            CREATE SCHEMA test_schema;
            CREATE TYPE test_schema.status AS ENUM ('c');
          `,
          testSql: `
            DROP TYPE test_schema.status;
            CREATE TYPE test_schema.status AS ENUM ('a', 'b', 'c');
          `,
        });
      }),
    );
    test(
      "add leading and trailing enum values around an existing value",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
            CREATE SCHEMA test_schema;
            CREATE TYPE test_schema.status AS ENUM ('b');
          `,
          testSql: `
            DROP TYPE test_schema.status;
            CREATE TYPE test_schema.status AS ENUM ('a', 'b', 'c');
          `,
          assertSqlStatements: (sqlStatements) => {
            expect(sqlStatements).toEqual([
              "ALTER TYPE test_schema.status ADD VALUE 'a' BEFORE 'b'",
              "ALTER TYPE test_schema.status ADD VALUE 'c' AFTER 'b'",
            ]);
          },
        });
      }),
    );
    test(
      "add enum value before setting default to the new value",
      withDb(pgVersion, async (db) => {
        const initialSetup = `
          CREATE TYPE public.user_role AS ENUM ('admin', 'user');

          CREATE TABLE public.profiles (
            id integer PRIMARY KEY,
            role public.user_role DEFAULT 'user'
          );
        `;
        await db.main.query(initialSetup);
        await db.branch.query(initialSetup);
        // The branch setup itself needs two separate queries: using the new
        // value in the same implicit transaction would hit 55P04 — the exact
        // behavior the generated plan has to avoid.
        await db.branch.query("ALTER TYPE public.user_role ADD VALUE 'store'");
        await db.branch.query(
          "ALTER TABLE public.profiles ALTER COLUMN role SET DEFAULT 'store'",
        );

        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          assertPlan: (plan) => {
            expect(plan.units).toHaveLength(2);
            expect(plan.units[1].reason).toBe("enum_value_visibility");
          },
        });
      }),
    );

    test(
      "add enum value before adding check constraint that references it",
      withDb(pgVersion, async (db) => {
        const initialSetup = `
          CREATE TYPE public.order_status AS ENUM ('pending', 'shipped');

          CREATE TABLE public.orders (
            id integer PRIMARY KEY,
            status public.order_status DEFAULT 'pending'
          );
        `;
        await db.main.query(initialSetup);
        await db.branch.query(initialSetup);
        await db.branch.query(
          "ALTER TYPE public.order_status ADD VALUE 'delivered'",
        );
        await db.branch.query(`
          ALTER TABLE public.orders
          ADD CONSTRAINT status_check
          CHECK (status IN ('pending', 'shipped', 'delivered'))
        `);

        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          assertPlan: (plan) => {
            expect(plan.units).toHaveLength(2);
            expect(plan.units[1].reason).toBe("enum_value_visibility");
          },
        });
      }),
    );

    test(
      "create domain type with constraint",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA test_schema;",
          testSql: `
          CREATE DOMAIN test_schema.positive_int AS INTEGER CHECK (VALUE > 0);
        `,
        });
      }),
    );
    test(
      "domain CHECK function dependencies are ordered before domains",
      withDb(pgVersion, async (db) => {
        const schemaSql = "CREATE SCHEMA test_schema;";
        const testSql = dedent`
          CREATE FUNCTION test_schema.check_prefix(val text, prefix text)
          RETURNS boolean
          LANGUAGE sql
          IMMUTABLE
          AS $function$
          SELECT starts_with(val, prefix)
          $function$;

          CREATE DOMAIN test_schema.user_id AS text
            CHECK (test_schema.check_prefix(VALUE, 'user_'));

          CREATE DOMAIN test_schema.org_id AS text
            CHECK (test_schema.check_prefix(VALUE, 'org_'));
        `;

        await db.main.query(schemaSql);
        await db.branch.query(schemaSql);
        await db.branch.query(testSql);

        const planResult = await createPlan(db.main, db.branch);
        expect(planResult).toBeDefined();
        if (!planResult) {
          throw new Error("Expected planResult to be defined");
        }

        const statements = flattenPlanStatements(planResult.plan);
        const checkPrefixCreateIndex = statements.findIndex((statement) =>
          statement.includes("CREATE FUNCTION test_schema.check_prefix("),
        );
        const userDomainCreateIndex = statements.findIndex((statement) =>
          statement.includes("CREATE DOMAIN test_schema.user_id"),
        );
        const orgDomainCreateIndex = statements.findIndex((statement) =>
          statement.includes("CREATE DOMAIN test_schema.org_id"),
        );

        expect(checkPrefixCreateIndex).toBeGreaterThanOrEqual(0);
        expect(userDomainCreateIndex).toBeGreaterThanOrEqual(0);
        expect(orgDomainCreateIndex).toBeGreaterThanOrEqual(0);
        expect(checkPrefixCreateIndex).toBeLessThan(userDomainCreateIndex);
        expect(checkPrefixCreateIndex).toBeLessThan(orgDomainCreateIndex);

        const branchCatalog = await extractCatalog(db.branch);
        const hasUserDomainDependency = branchCatalog.depends.some(
          (depend) =>
            depend.dependent_stable_id.startsWith(
              "constraint:test_schema.user_id.",
            ) && depend.referenced_stable_id.includes("check_prefix("),
        );
        const hasOrgDomainDependency = branchCatalog.depends.some(
          (depend) =>
            depend.dependent_stable_id.startsWith(
              "constraint:test_schema.org_id.",
            ) && depend.referenced_stable_id.includes("check_prefix("),
        );

        expect(hasUserDomainDependency).toBe(true);
        expect(hasOrgDomainDependency).toBe(true);
      }),
    );
    test(
      "create composite type",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA test_schema;",
          testSql: `
          CREATE TYPE test_schema.address AS (
            street VARCHAR(90),
            city VARCHAR(90),
            state VARCHAR(2)
          );
        `,
        });
      }),
    );
    test(
      "domain CHECK dependency coexists with function using the domain type",
      withDb(pgVersion, async (db) => {
        const schemaSql = "CREATE SCHEMA test_schema;";
        const testSql = dedent`
          CREATE FUNCTION test_schema.check_prefix(val text, prefix text)
          RETURNS boolean
          LANGUAGE sql
          IMMUTABLE
          AS $function$
          SELECT starts_with(val, prefix)
          $function$;

          CREATE DOMAIN test_schema.user_id AS text
            CHECK (test_schema.check_prefix(VALUE, 'user_'));

          CREATE FUNCTION test_schema.normalize_user_id(input test_schema.user_id)
          RETURNS text
          LANGUAGE sql
          IMMUTABLE
          AS $function$
          SELECT lower(input::text)
          $function$;
        `;

        await db.main.query(schemaSql);
        await db.branch.query(schemaSql);
        await db.branch.query(testSql);

        const planResult = await createPlan(db.main, db.branch);
        expect(planResult).toBeDefined();
        if (!planResult) {
          throw new Error("Expected planResult to be defined");
        }

        const statements = flattenPlanStatements(planResult.plan);
        const checkPrefixCreateIndex = statements.findIndex((statement) =>
          statement.includes("CREATE FUNCTION test_schema.check_prefix("),
        );
        const domainCreateIndex = statements.findIndex((statement) =>
          statement.includes("CREATE DOMAIN test_schema.user_id"),
        );
        const normalizeCreateIndex = statements.findIndex((statement) =>
          statement.includes("CREATE FUNCTION test_schema.normalize_user_id("),
        );

        expect(checkPrefixCreateIndex).toBeGreaterThanOrEqual(0);
        expect(domainCreateIndex).toBeGreaterThanOrEqual(0);
        expect(normalizeCreateIndex).toBeGreaterThanOrEqual(0);
        expect(checkPrefixCreateIndex).toBeLessThan(domainCreateIndex);
        expect(domainCreateIndex).toBeLessThan(normalizeCreateIndex);
      }),
    );
    test(
      "create range type",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA test_schema;",
          testSql: `
          CREATE TYPE test_schema.floatrange AS RANGE (subtype = float8);
        `,
        });
      }),
    );
    test(
      "drop enum type",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup:
            "CREATE SCHEMA test_schema; CREATE TYPE test_schema.old_mood AS ENUM ('sad', 'happy');",
          testSql: `
          DROP TYPE test_schema.old_mood;
        `,
        });
      }),
    );
    test(
      "replace enum type (modify values)",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup:
            "CREATE SCHEMA test_schema; CREATE TYPE test_schema.status AS ENUM ('pending', 'approved');",
          testSql: `
          DROP TYPE test_schema.status;
          CREATE TYPE test_schema.status AS ENUM ('pending', 'approved', 'rejected');
        `,
        });
      }),
    );
    test(
      "replace domain type (modify constraint)",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup:
            "CREATE SCHEMA test_schema; CREATE DOMAIN test_schema.valid_int AS INTEGER CHECK (VALUE > 0);",
          testSql: `
          DROP DOMAIN test_schema.valid_int;
          CREATE DOMAIN test_schema.valid_int AS INTEGER CHECK (VALUE >= 0 AND VALUE <= 100);
        `,
        });
      }),
    );

    test(
      "enum type with table dependency",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          name: "enum-table-dependency",
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA test_schema;",
          testSql: `
      CREATE TYPE test_schema.user_status AS ENUM ('active', 'inactive', 'pending');

      CREATE TABLE test_schema.users (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        status test_schema.user_status DEFAULT 'pending'
      );
    `,
        });
      }),
    );

    test(
      "domain type with table dependency",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          name: "domain-table-dependency",
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA test_schema;",
          testSql: `
        CREATE DOMAIN test_schema.email AS TEXT CHECK (VALUE ~ '^[^@]+@[^@]+\\.[^@]+$');

        CREATE TABLE test_schema.users (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          email_address test_schema.email
        );
      `,
        });
      }),
    );

    test(
      "composite type with table dependency",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          name: "composite-table-dependency",
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA test_schema;",
          testSql: `
        CREATE TYPE test_schema.address AS (
          street TEXT,
          city TEXT,
          zip_code TEXT
        );

        CREATE TABLE test_schema.customers (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          billing_address test_schema.address,
          shipping_address test_schema.address
        );
      `,
        });
      }),
    );

    test(
      "multiple types complex dependencies",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          name: "multiple-types-complex-dependencies",
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA commerce;",
          testSql: `
        -- Create base types
        CREATE TYPE commerce.order_status AS ENUM ('pending', 'processing', 'shipped', 'delivered', 'cancelled');
        CREATE DOMAIN commerce.price AS DECIMAL(10,2) CHECK (VALUE >= 0);

        -- Create composite type using domain
        CREATE TYPE commerce.product_info AS (
          name TEXT,
          description TEXT,
          unit_price commerce.price
        );

        -- Create tables using all types
        CREATE TABLE commerce.products (
          id INTEGER PRIMARY KEY,
          info commerce.product_info,
          category TEXT
        );

        CREATE TABLE commerce.orders (
          id INTEGER PRIMARY KEY,
          status commerce.order_status DEFAULT 'pending',
          total_amount commerce.price
        );
      `,
        });
      }),
    );

    test(
      "type cascade drop with dependent table",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          name: "type-cascade-drop-dependent-table",
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
        CREATE SCHEMA test_schema;
        CREATE TYPE test_schema.priority AS ENUM ('low', 'medium', 'high');
        CREATE TABLE test_schema.tasks (
          id INTEGER PRIMARY KEY,
          title TEXT,
          priority test_schema.priority DEFAULT 'medium'
        );
      `,
          testSql: `
        DROP TABLE test_schema.tasks;
        DROP TYPE test_schema.priority;
      `,
        });
      }),
    );

    test(
      "type name with special characters",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          name: "type-name-special-characters",
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: 'CREATE SCHEMA "test-schema";',
          testSql: `
        CREATE TYPE "test-schema"."user-status" AS ENUM ('active', 'in-active');
        CREATE DOMAIN "test-schema"."positive-number" AS INTEGER CHECK (VALUE > 0);
      `,
        });
      }),
    );

    test(
      "materialized view with enum dependency",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          name: "materialized-view-enum-dependency",
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA analytics;",
          testSql: dedent`
        CREATE TYPE analytics.status AS ENUM ('active', 'inactive', 'pending');

        CREATE TABLE analytics.users (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          status analytics.status DEFAULT 'pending'
        );

        CREATE MATERIALIZED VIEW analytics.user_status_summary AS
        SELECT
          status,
          COUNT(*) as count
        FROM analytics.users
        GROUP BY status;
      `,
        });
      }),
    );

    test(
      "materialized view with domain dependency",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          name: "materialized-view-domain-dependency",
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA financial;",
          testSql: dedent`
        CREATE DOMAIN financial.currency AS DECIMAL(10,2) CHECK (VALUE >= 0);

        CREATE TABLE financial.transactions (
          id INTEGER PRIMARY KEY,
          amount financial.currency NOT NULL,
          description TEXT
        );

        CREATE MATERIALIZED VIEW financial.transaction_summary AS
        SELECT
          SUM(amount) as total_amount,
          COUNT(*) as transaction_count
        FROM financial.transactions
        WHERE amount > 0;
      `,
        });
      }),
    );

    test(
      "materialized view with composite type dependency",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          name: "materialized-view-composite-dependency",
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA inventory;",
          testSql: dedent`
        CREATE TYPE inventory.address AS (
          street TEXT,
          city TEXT,
          zip_code TEXT
        );

        CREATE TABLE inventory.warehouses (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          location inventory.address
        );

        CREATE MATERIALIZED VIEW inventory.warehouse_locations AS
        SELECT
          name,
          (location).city as city,
          (location).zip_code as zip_code
        FROM inventory.warehouses
        WHERE (location).city IS NOT NULL;
      `,
        });
      }),
    );

    test(
      "complex mixed dependencies with materialized views",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          name: "complex-mixed-dependencies-materialized-views",
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA ecommerce;",
          testSql: dedent`
        -- Create types
        CREATE TYPE ecommerce.order_status AS ENUM ('pending', 'processing', 'shipped', 'delivered');
        CREATE DOMAIN ecommerce.price AS DECIMAL(10,2) CHECK (VALUE >= 0);
        CREATE TYPE ecommerce.product_info AS (
          name TEXT,
          description TEXT,
          base_price ecommerce.price
        );

        -- Create tables using the types
        CREATE TABLE ecommerce.products (
          id INTEGER PRIMARY KEY,
          info ecommerce.product_info NOT NULL,
          category TEXT
        );

        CREATE TABLE ecommerce.orders (
          id INTEGER PRIMARY KEY,
          status ecommerce.order_status DEFAULT 'pending',
          final_price ecommerce.price NOT NULL
        );

        -- Create materialized views that depend on the tables and types
        CREATE MATERIALIZED VIEW ecommerce.product_pricing AS
        SELECT
          id,
          (info).name as product_name,
          (info).base_price as base_price,
          category
        FROM ecommerce.products
        WHERE (info).base_price > 0;

        CREATE MATERIALIZED VIEW ecommerce.order_summary AS
        SELECT
          status,
          COUNT(*) as order_count,
          AVG(final_price) as avg_price
        FROM ecommerce.orders
        GROUP BY status;
      `,
        });
      }),
    );

    test(
      "drop type with materialized view dependency",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          name: "drop-type-materialized-view-dependency",
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
        CREATE SCHEMA reporting;
        CREATE TYPE reporting.priority AS ENUM ('low', 'medium', 'high');
        CREATE TABLE reporting.tasks (
          id INTEGER PRIMARY KEY,
          title TEXT NOT NULL,
          priority reporting.priority DEFAULT 'medium'
        );
        CREATE MATERIALIZED VIEW reporting.priority_stats AS
        SELECT
          priority,
          COUNT(*) as task_count
        FROM reporting.tasks
        GROUP BY priority;
      `,
          testSql: `
        DROP MATERIALIZED VIEW reporting.priority_stats;
        DROP TABLE reporting.tasks;
        DROP TYPE reporting.priority;
      `,
        });
      }),
    );

    test(
      "materialized view with range type dependency",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          name: "materialized-view-range-dependency",
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA scheduling;",
          testSql: dedent`
        CREATE TYPE scheduling.time_range AS RANGE (subtype = timestamp);

        CREATE TABLE scheduling.events (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          time_slot scheduling.time_range
        );

        CREATE MATERIALIZED VIEW scheduling.event_durations AS
        SELECT
          name,
          EXTRACT(EPOCH FROM (upper(time_slot) - lower(time_slot))) / 3600 as duration_hours
        FROM scheduling.events
        WHERE time_slot IS NOT NULL;
      `,
        });
      }),
    );

    test(
      "type comments",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA test_schema;",
          testSql: `
        CREATE TYPE test_schema.mood AS ENUM ('sad', 'ok', 'happy');
        CREATE DOMAIN test_schema.positive_int AS INTEGER CHECK (VALUE > 0);
        CREATE TYPE test_schema.address AS (
          street TEXT,
          city TEXT
        );

        COMMENT ON TYPE test_schema.mood IS 'mood type';
        COMMENT ON DOMAIN test_schema.positive_int IS 'positive integer domain';
        COMMENT ON TYPE test_schema.address IS 'address composite type';
      `,
          sortChangesCallback: (a, b) => {
            const priority = (change: Change) => {
              if (
                change.objectType === "domain" &&
                change.scope === "comment"
              ) {
                return 0;
              }
              if (change.objectType === "enum" && change.scope === "comment") {
                return 1;
              }
              if (
                change.objectType === "composite_type" &&
                change.scope === "comment"
              ) {
                return 2;
              }
              if (
                change.objectType === "domain" &&
                change.operation === "create"
              ) {
                return 3;
              }
              if (
                change.objectType === "enum" &&
                change.operation === "create"
              ) {
                return 4;
              }
              if (
                change.objectType === "composite_type" &&
                change.operation === "create"
              ) {
                return 5;
              }
              return 6;
            };
            return priority(a) - priority(b);
          },
        });
      }),
    );
  });
}
