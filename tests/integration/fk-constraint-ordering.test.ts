/**
 * Integration tests to validate the specific FK constraint ordering theory.
 *
 * This test validates the theory mentioned in the PR about the stableId fix
 * for AlterTableAddConstraint where foreign key constraints were being created
 * before the referenced table existed.
 */

import { describe } from "vitest";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { getTest } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTest(pgVersion);

  describe.concurrent(
    `FK constraint ordering validation (pg${pgVersion})`,
    () => {
      test("FK constraint created before referenced table - should fail without stableId fix", async ({
        db,
      }) => {
        // This test reproduces the exact scenario mentioned in the PR
        // where the FK constraint was being created before the referenced table
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
        `,
          testSql: `
          -- Create the referencing table first (this is the problematic scenario)
          CREATE TABLE test_schema.orders (
            id integer PRIMARY KEY,
            customer_id integer NOT NULL,
            order_date date
          );
          
          -- Create the referenced table second
          CREATE TABLE test_schema.customers (
            id integer PRIMARY KEY,
            name text NOT NULL,
            email text UNIQUE
          );
          
          -- Add foreign key constraint - this should work because customers table exists
          -- But without the stableId fix, this might be ordered incorrectly
          ALTER TABLE test_schema.orders 
          ADD CONSTRAINT orders_customer_fkey 
          FOREIGN KEY (customer_id) REFERENCES test_schema.customers(id);
        `,
          description:
            "FK constraint created before referenced table - should fail without stableId fix",
          expectedSqlTerms: false,
        });
      });

      test("complex FK constraint chain with multiple references", async ({
        db,
      }) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA ecommerce;
        `,
          testSql: `
          -- Create tables in a potentially problematic order
          CREATE TABLE ecommerce.order_items (
            id integer PRIMARY KEY,
            order_id integer NOT NULL,
            product_id integer NOT NULL,
            quantity integer NOT NULL
          );
          
          CREATE TABLE ecommerce.orders (
            id integer PRIMARY KEY,
            customer_id integer NOT NULL,
            order_date date NOT NULL
          );
          
          CREATE TABLE ecommerce.customers (
            id integer PRIMARY KEY,
            name text NOT NULL,
            email text UNIQUE NOT NULL
          );
          
          CREATE TABLE ecommerce.products (
            id integer PRIMARY KEY,
            name text NOT NULL,
            price decimal NOT NULL
          );
          
          -- Add foreign key constraints in the order they were discovered
          -- This tests the stableId fix for multiple FK constraints
          ALTER TABLE ecommerce.orders 
          ADD CONSTRAINT orders_customer_fkey 
          FOREIGN KEY (customer_id) REFERENCES ecommerce.customers(id);
          
          ALTER TABLE ecommerce.order_items 
          ADD CONSTRAINT order_items_order_fkey 
          FOREIGN KEY (order_id) REFERENCES ecommerce.orders(id);
          
          ALTER TABLE ecommerce.order_items 
          ADD CONSTRAINT order_items_product_fkey 
          FOREIGN KEY (product_id) REFERENCES ecommerce.products(id);
        `,
          description: "complex FK constraint chain with multiple references",
          expectedSqlTerms: false,
        });
      });

      test("FK constraint with deferred validation", async ({ db }) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
        `,
          testSql: `
          -- Create tables
          CREATE TABLE test_schema.parent (
            id integer PRIMARY KEY,
            name text NOT NULL
          );
          
          CREATE TABLE test_schema.child (
            id integer PRIMARY KEY,
            parent_id integer,
            name text NOT NULL
          );
          
          -- Add foreign key constraint with deferred validation
          ALTER TABLE test_schema.child 
          ADD CONSTRAINT child_parent_fkey 
          FOREIGN KEY (parent_id) REFERENCES test_schema.parent(id)
          DEFERRABLE INITIALLY DEFERRED;
        `,
          description: "FK constraint with deferred validation",
          expectedSqlTerms: false,
        });
      });

      test("self-referencing FK constraint", async ({ db }) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
        `,
          testSql: `
          -- Create a table with self-referencing foreign key
          CREATE TABLE test_schema.categories (
            id integer PRIMARY KEY,
            name text NOT NULL,
            parent_id integer
          );
          
          -- Add self-referencing foreign key constraint
          ALTER TABLE test_schema.categories 
          ADD CONSTRAINT categories_parent_fkey 
          FOREIGN KEY (parent_id) REFERENCES test_schema.categories(id);
        `,
          description: "self-referencing FK constraint",
          expectedSqlTerms: false,
        });
      });

      test("FK constraint with ON DELETE/UPDATE actions", async ({ db }) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
        `,
          testSql: `
          -- Create tables
          CREATE TABLE test_schema.users (
            id integer PRIMARY KEY,
            name text NOT NULL
          );
          
          CREATE TABLE test_schema.orders (
            id integer PRIMARY KEY,
            user_id integer NOT NULL,
            status text NOT NULL
          );
          
          -- Add foreign key constraint with CASCADE actions
          ALTER TABLE test_schema.orders 
          ADD CONSTRAINT orders_user_fkey 
          FOREIGN KEY (user_id) REFERENCES test_schema.users(id)
          ON DELETE CASCADE ON UPDATE CASCADE;
        `,
          description: "FK constraint with ON DELETE/UPDATE actions",
          expectedSqlTerms: false,
        });
      });
    },
  );
}
