/**
 * Integration tests for mixed database objects (schemas + tables).
 */

import { describe } from "vitest";
import { AlterTableAddColumn } from "../../src/objects/table/changes/table.alter.ts";
import { CreateView } from "../../src/objects/view/changes/view.create.ts";
import { DropView } from "../../src/objects/view/changes/view.drop.ts";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { getTest } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTest(pgVersion);

  describe.concurrent(`mixed objects (pg${pgVersion})`, () => {
    test("schema and table creation", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "",
        testSql: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.users (
            id integer,
            name text NOT NULL,
            email text,
            created_at timestamp DEFAULT now()
          );
        `,
      });
    });

    test("multiple schemas and tables", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "",
        testSql: `
          CREATE SCHEMA core;
          CREATE SCHEMA analytics;

          CREATE TABLE core.users (
            id integer,
            username text NOT NULL,
            email text
          );

          CREATE TABLE core.posts (
            id integer,
            title text NOT NULL,
            content text,
            user_id integer
          );

          CREATE TABLE analytics.user_stats (
            user_id integer,
            post_count integer DEFAULT 0,
            last_login timestamp
          );
        `,
      });
    });

    test("complex column types", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "",
        testSql: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.complex_table (
            id uuid,
            metadata jsonb,
            tags text[],
            coordinates point,
            price numeric(10,2),
            is_active boolean DEFAULT true,
            created_at timestamptz DEFAULT now()
          );
        `,
      });
    });

    test("empty database", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "",
        testSql: "",
        expectedSqlTerms: [], // No SQL terms
        expectedMainDependencies: [], // Main has no dependencies (empty state)
        expectedBranchDependencies: [], // Branch has no dependencies (empty state)
      });
    });

    test("schema only", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "",
        testSql: "CREATE SCHEMA empty_schema;",
      });
    });

    test("e-commerce with sequences, tables, constraints, and indexes", async ({
      db,
    }) => {
      // TODO: fix this test, if we skip the dependencies checks we get a CycleError exception
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "",
        testSql: `
          CREATE SCHEMA ecommerce;

          -- Create customers table with SERIAL primary key
          CREATE TABLE ecommerce.customers (
            id SERIAL PRIMARY KEY,
            email VARCHAR(255) UNIQUE NOT NULL,
            first_name VARCHAR(100) NOT NULL,
            last_name VARCHAR(100) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );

          -- Create orders table with SERIAL primary key and foreign key
          CREATE TABLE ecommerce.orders (
            id SERIAL PRIMARY KEY,
            customer_id INTEGER NOT NULL,
            order_number VARCHAR(50) UNIQUE NOT NULL,
            status VARCHAR(20) DEFAULT 'pending',
            total_amount DECIMAL(10,2) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT fk_customer FOREIGN KEY (customer_id) REFERENCES ecommerce.customers(id)
          );

          -- Create index for common queries
          CREATE INDEX idx_orders_customer_status ON ecommerce.orders(customer_id, status);
          CREATE INDEX idx_customers_email ON ecommerce.customers(email);
        `,
      });
    });

    test("complex dependency ordering", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema",
        testSql: `
          -- Create base tables
          CREATE TABLE test_schema.users (
            id integer PRIMARY KEY,
            name text
          );

          CREATE TABLE test_schema.orders (
            id integer PRIMARY KEY,
            user_id integer,
            amount numeric
          );

          -- Create view that depends on both tables
          CREATE VIEW test_schema.user_orders AS
            SELECT u.id, u.name, SUM(o.amount) as total
            FROM test_schema.users u
            LEFT JOIN test_schema.orders o ON u.id = o.user_id
            GROUP BY u.id, u.name;

          -- Create view that depends on the first view
          CREATE VIEW test_schema.top_users AS
            SELECT * FROM test_schema.user_orders
            WHERE total > 1000;
        `,
        sortChangesCallback: (a, b) => {
          // force create view top_users before user_orders to test that we track the dependency view -> view's columns
          if (
            a instanceof CreateView &&
            b instanceof CreateView &&
            a.view.schema === "test_schema" &&
            b.view.schema === "test_schema"
          ) {
            if (a.view.name === "top_users" && b.view.name === "user_orders") {
              return -1;
            }
            if (a.view.name === "user_orders" && b.view.name === "top_users") {
              return 1;
            }
          }
          return 0;
        },
      });
    });

    test("drop operations with complex dependencies", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;

          -- Create a complex dependency chain
          CREATE TABLE test_schema.base (
            id integer PRIMARY KEY
          );

          CREATE VIEW test_schema.v1 AS SELECT * FROM test_schema.base;
          CREATE VIEW test_schema.v2 AS SELECT * FROM test_schema.v1;
          CREATE VIEW test_schema.v3 AS SELECT * FROM test_schema.v2;
        `,
        testSql: `
          -- Drop everything to test dependency ordering
          DROP VIEW test_schema.v3;
          DROP VIEW test_schema.v2;
          DROP VIEW test_schema.v1;
          DROP TABLE test_schema.base;
          DROP SCHEMA test_schema;
        `,
        sortChangesCallback: (a, b) => {
          // force drop view v1 before v2 and drop view v2 before v3
          if (b instanceof DropView && a instanceof DropView) {
            if (b.view.name === "v1" && a.view.name === "v2") {
              return -1;
            }
            if (b.view.name === "v2" && a.view.name === "v3") {
              return -1;
            }
          }
          return 0;
        },
      });
    });

    test("mixed create and replace operations", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;

          CREATE TABLE test_schema.data (
            id integer PRIMARY KEY,
            value text
          );

          CREATE VIEW test_schema.summary AS
            SELECT COUNT(*) as cnt FROM test_schema.data;
        `,
        testSql: `
          -- Add column and update view
          ALTER TABLE test_schema.data ADD COLUMN status text;

          CREATE OR REPLACE VIEW test_schema.summary AS
            SELECT COUNT(*) as cnt,
                   COUNT(CASE WHEN status = 'active' THEN 1 END) as active_cnt
            FROM test_schema.data;
        `,
        sortChangesCallback: (a, b) => {
          // force create view before alter table to test that we track the dependency view -> column
          if (b instanceof CreateView && a instanceof AlterTableAddColumn) {
            return 1;
          }
          return -1;
        },
      });
    });

    test("cross-schema view dependencies", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA schema_a;
          CREATE SCHEMA schema_b;

          CREATE TABLE schema_a.table_a (id integer PRIMARY KEY);
          CREATE TABLE schema_b.table_b (id integer PRIMARY KEY);

          -- View in schema_a that references table in schema_b
          CREATE VIEW schema_a.cross_view AS
            SELECT a.id as a_id, b.id as b_id
            FROM schema_a.table_a a
            CROSS JOIN schema_b.table_b b;
        `,
        testSql: "", // No changes - just test dependency extraction
      });
    });

    test("basic table schema dependency validation", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "",
        testSql: `
          CREATE SCHEMA analytics;
          CREATE TABLE analytics.users (
            id integer,
            name text
          );
        `,
      });
    });

    test("multiple independent schema table pairs", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "",
        testSql: `
          CREATE SCHEMA app;
          CREATE SCHEMA analytics;
          CREATE TABLE app.users (id integer);
          CREATE TABLE analytics.reports (id integer);
        `,
      });
    });

    test("drop schema only", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA temp_schema;
        `,
        testSql: `
          DROP SCHEMA temp_schema;
        `,
      });
    });

    test("multiple drops with dependency ordering", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA app;
          CREATE SCHEMA analytics;
          CREATE TABLE app.users (id integer);
          CREATE TABLE analytics.reports (id integer);
        `,
        testSql: `
          DROP TABLE app.users;
          DROP TABLE analytics.reports;
          DROP SCHEMA app;
          DROP SCHEMA analytics;
        `,
      });
    });

    test("complex multi-schema drop scenario", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA core;
          CREATE SCHEMA analytics;
          CREATE SCHEMA reporting;
          CREATE TABLE core.users (id integer);
          CREATE TABLE analytics.events (id integer);
          CREATE TABLE reporting.summary (id integer);
        `,
        testSql: `
          DROP TABLE core.users;
          DROP TABLE analytics.events;
          DROP TABLE reporting.summary;
          DROP SCHEMA core;
          DROP SCHEMA analytics;
          DROP SCHEMA reporting;
        `,
      });
    });

    test("schema comments", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `CREATE SCHEMA test_schema;`,
        testSql: `
          COMMENT ON SCHEMA test_schema IS 'a test schema';
        `,
      });
    });
  });
}
