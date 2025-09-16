/**
 * Integration tests to validate CHECK constraint ordering theory.
 *
 * This test validates the theory about CHECK constraints that reference
 * non-existent objects (functions, types, etc.) and whether the dependency
 * system properly handles the ordering.
 */

import { describe } from "vitest";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { getTest } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTest(pgVersion);

  describe.concurrent(
    `CHECK constraint ordering validation (pg${pgVersion})`,
    () => {
      test("CHECK constraint referencing function created later", async ({
        db,
      }) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
        `,
          testSql: `
          -- Create a table with CHECK constraint that references a function
          -- that will be created later
          CREATE TABLE test_schema.products (
            id integer PRIMARY KEY,
            name text NOT NULL,
            price decimal NOT NULL,
            status text NOT NULL
          );
          
          -- Create the function that the CHECK constraint references
          CREATE OR REPLACE FUNCTION test_schema.validate_price(price decimal)
          RETURNS boolean AS $$
          BEGIN
            RETURN price > 0 AND price < 1000000;
          END;
          $$ LANGUAGE plpgsql;
          
          CREATE OR REPLACE FUNCTION test_schema.validate_status(status text)
          RETURNS boolean AS $$
          BEGIN
            RETURN status IN ('active', 'inactive', 'pending', 'archived');
          END;
          $$ LANGUAGE plpgsql;
          
          -- Add CHECK constraints that reference the functions
          ALTER TABLE test_schema.products 
          ADD CONSTRAINT products_price_valid 
          CHECK (test_schema.validate_price(price));
          
          ALTER TABLE test_schema.products 
          ADD CONSTRAINT products_status_valid 
          CHECK (test_schema.validate_status(status));
        `,
        });
      });

      test("CHECK constraint referencing custom type created later", async ({
        db,
      }) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
        `,
          testSql: `
          -- Create a table that will reference a custom type
          CREATE TABLE test_schema.orders (
            id integer PRIMARY KEY,
            status text NOT NULL,
            priority text NOT NULL
          );
          
          -- Create custom types
          CREATE TYPE test_schema.order_status AS ENUM ('pending', 'processing', 'shipped', 'delivered', 'cancelled');
          CREATE TYPE test_schema.priority_level AS ENUM ('low', 'medium', 'high', 'urgent');
          
          -- Add CHECK constraints that reference the custom types
          ALTER TABLE test_schema.orders 
          ADD CONSTRAINT orders_status_valid 
          CHECK (status::test_schema.order_status IS NOT NULL);
          
          ALTER TABLE test_schema.orders 
          ADD CONSTRAINT orders_priority_valid 
          CHECK (priority::test_schema.priority_level IS NOT NULL);
        `,
        });
      });
    },
  );
}
