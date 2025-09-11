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
        description: "create btree index",
        expectedMainDependencies: [
          {
            dependent_stable_id: "table:test_schema.users",
            referenced_stable_id: "schema:test_schema",
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
            dependent_stable_id: "index:test_schema.idx_users_email",
            referenced_stable_id: "table:test_schema.users",
            deptype: "a",
          },
        ],
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
        description: "create unique index",
        expectedMainDependencies: [
          {
            dependent_stable_id: "table:test_schema.products",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "table:test_schema.products",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "index:test_schema.idx_products_sku",
            referenced_stable_id: "table:test_schema.products",
            deptype: "a",
          },
        ],
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
        description: "create partial index",
        expectedMainDependencies: [
          {
            dependent_stable_id: "table:test_schema.orders",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "table:test_schema.orders",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "index:test_schema.idx_orders_pending",
            referenced_stable_id: "table:test_schema.orders",
            deptype: "a",
          },
        ],
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
        description: "create functional index",
        expectedMainDependencies: [
          {
            dependent_stable_id: "table:test_schema.customers",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "table:test_schema.customers",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "index:test_schema.idx_customers_email_lower",
            referenced_stable_id: "table:test_schema.customers",
            deptype: "a",
          },
        ],
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
        description: "create multicolumn index",
        expectedMainDependencies: [
          {
            dependent_stable_id: "table:test_schema.sales",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "table:test_schema.sales",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "index:test_schema.idx_sales_region_date",
            referenced_stable_id: "table:test_schema.sales",
            deptype: "a",
          },
        ],
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
        description: "drop index",
        expectedSqlTerms: [`DROP INDEX test_schema.idx_items_name`],
        expectedMainDependencies: [
          {
            dependent_stable_id: "table:test_schema.items",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "index:test_schema.idx_items_name",
            referenced_stable_id: "table:test_schema.items",
            deptype: "a",
          },
        ],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "table:test_schema.items",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
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
        description: "drop implicit dependent table index",
        expectedSqlTerms: ["DROP TABLE test_schema.test_table"],
        expectedMainDependencies: [],
        expectedBranchDependencies: [],
      });
    });
  });
}
