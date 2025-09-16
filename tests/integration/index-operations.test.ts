/**
 * Integration tests for PostgreSQL index operations.
 */

import { describe } from "vitest";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { getTest } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTest(pgVersion);

  // TODO: Fix index dependency detection issues
  describe.concurrent(`index operations (pg${pgVersion})`, () => {
    test("create btree index", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.users (
            id integer,
            email character varying(255)
          );
        `,
        testSql:
          "CREATE INDEX idx_users_email ON test_schema.users USING btree (email);",
      });
    });

    test("create unique index", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.products (
            id integer,
            sku character varying(50)
          );
        `,
        testSql:
          "CREATE UNIQUE INDEX idx_products_sku ON test_schema.products USING btree (sku);",
      });
    });

    test("create partial index", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.orders (
            id integer,
            status character varying(20),
            created_at timestamp
          );
        `,
        testSql:
          "CREATE INDEX idx_orders_pending ON test_schema.orders USING btree (created_at) WHERE status::text = 'pending'::text;",
      });
    });

    test("create functional index", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.customers (
            id integer,
            email character varying(255)
          );
        `,
        testSql:
          "CREATE INDEX idx_customers_email_lower ON test_schema.customers USING btree (lower(email::text));",
      });
    });

    test("create multicolumn index", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.sales (
            id integer,
            region character varying(50),
            product_id integer,
            sale_date date
          );
        `,
        testSql:
          "CREATE INDEX idx_sales_region_date ON test_schema.sales USING btree (region, sale_date);",
      });
    });

    test("drop index", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.items (
            id integer,
            name character varying(100)
          );
          CREATE INDEX idx_items_name ON test_schema.items (name);
        `,
        testSql: `
          DROP INDEX test_schema.idx_items_name;
        `,
      });
    });

    test("drop implicit dependent table index", async ({ db }) => {
      await roundtripFidelityTest({
        name: "drop-implicit-dependent-table-index",
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
        CREATE SCHEMA test_schema;
        CREATE TABLE test_schema.test_table (
          id integer PRIMARY KEY,
          name text
        );
        CREATE INDEX test_table_name_index ON test_schema.test_table (name);
      `,
        // Drop the table, which will drop the index as well no further changes are needed
        testSql: `
        DROP TABLE test_schema.test_table;
      `,
      });
    });
  });
}
