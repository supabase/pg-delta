/**
 * Integration tests for handling circular dependencies between tables and functions.
 *
 * This verifies the fix for the issue where functions with RETURNS SETOF table_name
 * need tables to be created first, while tables with defaults using functions need
 * functions to be created first.
 */

import dedent from "dedent";
import { describe } from "vitest";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { getTest } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTest(pgVersion);

  describe.concurrent(`table-function circular dependency (pg${pgVersion})`, () => {
    test("function with RETURNS SETOF table", async ({ db }) => {
      // This tests the case where a function references a table in its return type
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: dedent`
            -- Create the table first
            CREATE TABLE test_schema.items (
              id bigserial PRIMARY KEY,
              name text NOT NULL,
              price numeric(10,2)
            );

            -- Create a function that returns SETOF the table
            -- This requires the table to exist for the return type validation
            CREATE FUNCTION test_schema.get_expensive_items()
            RETURNS SETOF test_schema.items
            LANGUAGE sql
            STABLE
            AS $function$
              SELECT * FROM test_schema.items WHERE price > 100
            $function$;
          `,
      });
    });

    test("table with function-based default and function with RETURNS SETOF", async ({
      db,
    }) => {
      // This tests both circular dependency cases:
      // 1. Function depends on table (RETURNS SETOF)
      // 2. Table depends on function (DEFAULT)
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: dedent`
            -- Create a helper function first
            CREATE FUNCTION test_schema.next_order_number()
            RETURNS integer
            LANGUAGE plpgsql
            VOLATILE
            AS $function$
            BEGIN
              RETURN (SELECT coalesce(max(order_number), 0) + 1 FROM test_schema.orders);
            END;
            $function$;

            -- Create table with function-based default
            -- This table depends on the function
            CREATE TABLE test_schema.orders (
              id bigserial PRIMARY KEY,
              order_number integer DEFAULT test_schema.next_order_number(),
              total_amount numeric(10,2),
              created_at timestamp DEFAULT now()
            );

            -- Create a function that returns SETOF the table
            -- This function depends on the table
            CREATE FUNCTION test_schema.get_recent_orders()
            RETURNS SETOF test_schema.orders
            LANGUAGE sql
            STABLE
            AS $function$
              SELECT * FROM test_schema.orders
              WHERE created_at > now() - interval '7 days'
              ORDER BY created_at DESC
            $function$;
          `,
      });
    });

    test("complex circular dependencies with multiple tables and functions", async ({
      db,
    }) => {
      // This tests a more complex scenario with multiple inter-dependent objects
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: dedent`
            -- Create initial function
            CREATE FUNCTION test_schema.generate_id()
            RETURNS bigint
            LANGUAGE sql
            VOLATILE
            AS $function$SELECT floor(random() * 1000000)::bigint$function$;

            -- Create first table with function default
            CREATE TABLE test_schema.customers (
              id bigint PRIMARY KEY DEFAULT test_schema.generate_id(),
              email text NOT NULL,
              name text
            );

            -- Create second table with function default
            CREATE TABLE test_schema.products (
              id bigint PRIMARY KEY DEFAULT test_schema.generate_id(),
              title text NOT NULL,
              price numeric(10,2)
            );

            -- Create function returning first table
            CREATE FUNCTION test_schema.get_customers_by_email(search_email text)
            RETURNS SETOF test_schema.customers
            LANGUAGE sql
            STABLE
            AS $function$
              SELECT * FROM test_schema.customers WHERE email = search_email
            $function$;

            -- Create function returning second table
            CREATE FUNCTION test_schema.get_products_by_price(max_price numeric)
            RETURNS SETOF test_schema.products
            LANGUAGE sql
            STABLE
            AS $function$
              SELECT * FROM test_schema.products WHERE price <= max_price
            $function$;

            -- Create another function that uses both tables
            CREATE FUNCTION test_schema.get_customer_count()
            RETURNS bigint
            LANGUAGE sql
            STABLE
            AS $function$SELECT count(*) FROM test_schema.customers$function$;
          `,
      });
    });

    test("materialized view with function returning table", async ({ db }) => {
      // Test that functions returning tables work with materialized views too
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: dedent`
            CREATE TABLE test_schema.transactions (
              id bigserial PRIMARY KEY,
              amount numeric(10,2),
              status text
            );

            CREATE FUNCTION test_schema.get_transactions_by_status(search_status text)
            RETURNS SETOF test_schema.transactions
            LANGUAGE sql
            STABLE
            AS $function$
              SELECT * FROM test_schema.transactions WHERE status = search_status
            $function$;

            CREATE MATERIALIZED VIEW test_schema.transaction_summary AS
            SELECT status, count(*) as count, sum(amount) as total
            FROM test_schema.transactions
            GROUP BY status;
          `,
      });
    });
  });
}
