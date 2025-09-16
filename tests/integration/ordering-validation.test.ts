/**
 * Integration tests to validate ordering theory for ALTER TABLE operations.
 *
 * These tests validate the theory about ordering issues with:
 * 1. ALTER TABLE ... OWNER TO ... operations and role creation dependencies
 * 2. CHECK constraints referencing non-existent objects
 * 3. Complex multi-dependency scenarios
 */

import { describe } from "vitest";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { getTestIsolated } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTestIsolated(pgVersion);

  describe.concurrent(`ordering validation (pg${pgVersion})`, () => {
    test("table owner change with role creation dependency", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.users (
            id integer PRIMARY KEY,
            name text
          );
        `,
        testSql: `
          -- Create a new role
          CREATE ROLE app_user WITH LOGIN;
          
          -- Change table owner to the new role
          ALTER TABLE test_schema.users OWNER TO app_user;
        `,
      });
    });

    test("complex owner change scenario with multiple tables and roles", async ({
      db,
    }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA app_schema;
          CREATE SCHEMA analytics_schema;
        `,
        testSql: `
          -- Create multiple roles
          CREATE ROLE app_admin WITH LOGIN;
          CREATE ROLE analytics_user WITH LOGIN;
          CREATE ROLE readonly_user WITH LOGIN;
          
          -- Create tables in different schemas
          CREATE TABLE app_schema.users (
            id integer PRIMARY KEY,
            email text UNIQUE
          );
          
          CREATE TABLE app_schema.orders (
            id integer PRIMARY KEY,
            user_id integer,
            amount decimal
          );
          
          CREATE TABLE analytics_schema.reports (
            id integer PRIMARY KEY,
            data jsonb
          );
          
          -- Change owners to different roles
          ALTER TABLE app_schema.users OWNER TO app_admin;
          ALTER TABLE app_schema.orders OWNER TO app_admin;
          ALTER TABLE analytics_schema.reports OWNER TO analytics_user;
        `,
        description:
          "complex owner change scenario with multiple tables and roles",
      });
    });

    test("check constraint referencing non-existent objects", async ({
      db,
    }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
        `,
        testSql: `
          -- Create a table with a CHECK constraint that references a function
          -- that doesn't exist yet (this should fail if ordering is wrong)
          CREATE TABLE test_schema.products (
            id integer PRIMARY KEY,
            name text,
            price decimal CHECK (price > 0),
            status text CHECK (status IN ('active', 'inactive', 'pending'))
          );
          
          -- Create a function that the CHECK constraint might reference
          CREATE OR REPLACE FUNCTION test_schema.validate_price(price decimal)
          RETURNS boolean AS $$
          BEGIN
            RETURN price > 0 AND price < 1000000;
          END;
          $$ LANGUAGE plpgsql;
          
          -- Add a CHECK constraint that references the function
          ALTER TABLE test_schema.products 
          ADD CONSTRAINT products_price_valid 
          CHECK (test_schema.validate_price(price));
        `,
      });
    });

    test("foreign key constraint ordering with table creation", async ({
      db,
    }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
        `,
        testSql: `
          -- Create tables in a specific order that might cause FK constraint issues
          CREATE TABLE test_schema.orders (
            id integer PRIMARY KEY,
            customer_id integer,
            order_date date
          );
          
          CREATE TABLE test_schema.customers (
            id integer PRIMARY KEY,
            name text NOT NULL
          );
          
          -- Add foreign key constraint - this should work because customers table exists
          ALTER TABLE test_schema.orders 
          ADD CONSTRAINT orders_customer_fkey 
          FOREIGN KEY (customer_id) REFERENCES test_schema.customers(id);
        `,
      });
    });

    test("complex multi-dependency scenario with owner changes", async ({
      db,
    }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA app_schema;
        `,
        testSql: `
          -- Create roles
          CREATE ROLE app_user WITH LOGIN;
          CREATE ROLE app_admin WITH LOGIN;
          
          -- Create a complex dependency chain
          CREATE TABLE app_schema.users (
            id integer PRIMARY KEY,
            email text UNIQUE
          );
          
          CREATE TABLE app_schema.orders (
            id integer PRIMARY KEY,
            user_id integer,
            status text
          );
          
          CREATE TABLE app_schema.order_items (
            id integer PRIMARY KEY,
            order_id integer,
            product_name text
          );
          
          -- Add foreign key constraints
          ALTER TABLE app_schema.orders 
          ADD CONSTRAINT orders_user_fkey 
          FOREIGN KEY (user_id) REFERENCES app_schema.users(id);
          
          ALTER TABLE app_schema.order_items 
          ADD CONSTRAINT order_items_order_fkey 
          FOREIGN KEY (order_id) REFERENCES app_schema.orders(id);
          
          -- Create a view that depends on all tables
          CREATE VIEW app_schema.user_order_summary AS
          SELECT u.id, u.email, COUNT(o.id) as order_count
          FROM app_schema.users u
          LEFT JOIN app_schema.orders o ON u.id = o.user_id
          GROUP BY u.id, u.email;
          
          -- Change owners
          ALTER TABLE app_schema.users OWNER TO app_admin;
          ALTER TABLE app_schema.orders OWNER TO app_admin;
          ALTER TABLE app_schema.order_items OWNER TO app_user;
          ALTER VIEW app_schema.user_order_summary OWNER TO app_admin;
        `,
      });
    });

    test("schema owner change with role dependency", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "",
        testSql: `
          -- Create a role
          CREATE ROLE schema_owner WITH LOGIN;
          
          -- Create a schema and immediately change its owner
          CREATE SCHEMA test_schema;
          ALTER SCHEMA test_schema OWNER TO schema_owner;
          
          -- Create a table in the schema
          CREATE TABLE test_schema.data (
            id integer PRIMARY KEY,
            value text
          );
        `,
      });
    });

    test("type owner change with role dependency", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
        `,
        testSql: `
          -- Create a role
          CREATE ROLE type_owner WITH LOGIN;
          
          -- Create a custom type
          CREATE TYPE test_schema.status_enum AS ENUM ('active', 'inactive', 'pending');
          
          -- Change type owner
          ALTER TYPE test_schema.status_enum OWNER TO type_owner;
          
          -- Create a table using the type
          CREATE TABLE test_schema.items (
            id integer PRIMARY KEY,
            status test_schema.status_enum DEFAULT 'pending'
          );
        `,
      });
    });
  });
}
