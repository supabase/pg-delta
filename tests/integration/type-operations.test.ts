/**
 * Integration tests for PostgreSQL type operations.
 */

import dedent from "dedent";
import { describe } from "vitest";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { getTest } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTest(pgVersion);

  describe.concurrent(`type operations (pg${pgVersion})`, () => {
    test("create enum type", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: `
          CREATE TYPE test_schema.mood AS ENUM ('sad', 'ok', 'happy');
        `,
      });
    });
    test("create domain type with constraint", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: `
          CREATE DOMAIN test_schema.positive_int AS INTEGER CHECK (VALUE > 0);
        `,
      });
    });
    test("create composite type", async ({ db }) => {
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
    });
    test("create range type", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: `
          CREATE TYPE test_schema.floatrange AS RANGE (subtype = float8);
        `,
      });
    });
    test("drop enum type", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup:
          "CREATE SCHEMA test_schema; CREATE TYPE test_schema.old_mood AS ENUM ('sad', 'happy');",
        testSql: `
          DROP TYPE test_schema.old_mood;
        `,
      });
    });
    test("replace enum type (modify values)", async ({ db }) => {
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
    });
    test("replace domain type (modify constraint)", async ({ db }) => {
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
    });

    test("enum type with table dependency", async ({ db }) => {
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
    });

    test("domain type with table dependency", async ({ db }) => {
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
    });

    test("composite type with table dependency", async ({ db }) => {
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
    });

    test("multiple types complex dependencies", async ({ db }) => {
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
    });

    test("type cascade drop with dependent table", async ({ db }) => {
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
    });

    test("type name with special characters", async ({ db }) => {
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
    });

    test("materialized view with enum dependency", async ({ db }) => {
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
    });

    test("materialized view with domain dependency", async ({ db }) => {
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
    });

    test("materialized view with composite type dependency", async ({ db }) => {
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
    });

    test("complex mixed dependencies with materialized views", async ({
      db,
    }) => {
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
    });

    test("drop type with materialized view dependency", async ({ db }) => {
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
    });

    test("materialized view with range type dependency", async ({ db }) => {
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
    });

    test("type comments", async ({ db }) => {
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
      });
    });
  });
}
