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
      });
    });

    test("materialized view comments", async ({ db }) => {
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
    });
  });
}
