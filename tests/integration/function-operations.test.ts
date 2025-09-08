/**
 * Integration tests for PostgreSQL function operations.
 */

import { describe } from "vitest";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { getTest } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTest(pgVersion);

  // TODO: Fix functions stable ids that must be the schema + name + argstypes because the current one is just the function name
  describe.concurrent(`function operations (pg${pgVersion})`, () => {
    test("simple function creation", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: `
          CREATE FUNCTION test_schema.add_numbers(a integer, b integer)
          RETURNS integer
          LANGUAGE sql
          IMMUTABLE
          AS 'SELECT $1 + $2';
        `,
        description: "simple function creation",
        expectedSqlTerms: [
          `CREATE OR REPLACE FUNCTION test_schema.add_numbers(a integer, b integer) RETURNS integer LANGUAGE sql IMMUTABLE AS 'SELECT ($1 + $2);'`,
        ],
        expectedMasterDependencies: [],
        expectedBranchDependencies: [
          {
            dependent_stable_id:
              "function:test_schema.add_numbers(integer,integer)",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
      });
    });

    test("plpgsql function with security definer", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: `
          CREATE FUNCTION test_schema.get_user_count()
          RETURNS bigint
          LANGUAGE plpgsql
          SECURITY DEFINER
          STABLE
          AS $$
          BEGIN
            RETURN (SELECT COUNT(*) FROM pg_catalog.pg_user);
          END;
          $$;
        `,
        description: "plpgsql function with security definer",
        expectedSqlTerms: [
          `CREATE OR REPLACE FUNCTION test_schema.get_user_count() RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$BEGIN
    RETURN ( SELECT count(*) AS count
           FROM pg_user);
END;$$`,
        ],
        expectedMasterDependencies: [],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "function:test_schema.get_user_count()",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
      });
    });

    test("function replacement", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE FUNCTION test_schema.version_function()
          RETURNS text
          LANGUAGE sql
          IMMUTABLE
          AS 'SELECT ''v1.0''';
        `,
        testSql: `
          CREATE OR REPLACE FUNCTION test_schema.version_function()
          RETURNS text
          LANGUAGE sql
          IMMUTABLE
          AS 'SELECT ''v2.0''';
        `,
        description: "function replacement",
        expectedSqlTerms: [
          `CREATE OR REPLACE FUNCTION test_schema.version_function() RETURNS text LANGUAGE sql IMMUTABLE AS 'SELECT ''v2.0''::text;'`,
        ],
        expectedMasterDependencies: [
          {
            dependent_stable_id: "function:test_schema.version_function()",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "function:test_schema.version_function()",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
      });
    });

    test("function overloading", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: `
          -- Function with one parameter
          CREATE FUNCTION test_schema.format_value(input_val integer)
          RETURNS text
          LANGUAGE sql
          IMMUTABLE
          AS 'SELECT input_val::text';

          -- Function with two parameters (overload)
          CREATE FUNCTION test_schema.format_value(input_val integer, prefix text)
          RETURNS text
          LANGUAGE sql
          IMMUTABLE
          AS 'SELECT prefix || input_val::text';
        `,
        description: "function overloading",
        expectedSqlTerms: [
          `CREATE OR REPLACE FUNCTION test_schema.format_value(input_val integer) RETURNS text LANGUAGE sql IMMUTABLE AS 'SELECT (input_val)::text;'`,
          `CREATE OR REPLACE FUNCTION test_schema.format_value(input_val integer, prefix text) RETURNS text LANGUAGE sql IMMUTABLE AS 'SELECT (prefix || (input_val)::text);'`,
        ],
        expectedMasterDependencies: [],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "function:test_schema.format_value(integer)",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id:
              "function:test_schema.format_value(integer,text)",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
      });
    });

    test("drop function", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE FUNCTION test_schema.temp_function()
          RETURNS text
          LANGUAGE sql
          AS 'SELECT ''temporary''';
        `,
        testSql: `
          DROP FUNCTION test_schema.temp_function();
        `,
        description: "drop function",
        expectedSqlTerms: [`DROP FUNCTION test_schema.temp_function()`],
        expectedMasterDependencies: [
          {
            dependent_stable_id: "function:test_schema.temp_function()",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
        expectedBranchDependencies: [],
      });
    });

    test("function with complex attributes", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: `
          CREATE FUNCTION test_schema.expensive_function(input_data text)
          RETURNS text
          LANGUAGE plpgsql
          VOLATILE
          STRICT
          PARALLEL RESTRICTED
          COST 1000
          AS $$
          BEGIN
            -- Simulate expensive operation
            PERFORM pg_sleep(0.1);
            RETURN upper(input_data);
          END;
          $$;
        `,
        description: "function with complex attributes",
        expectedSqlTerms: [
          "CREATE OR REPLACE FUNCTION test_schema.expensive_function(input_data text)",
          "RETURNS text",
          "LANGUAGE plpgsql",
          "STRICT",
          "PARALLEL RESTRICTED",
          "COST 1000",
        ],
        expectedMasterDependencies: [],
        expectedBranchDependencies: [
          {
            dependent_stable_id:
              "function:test_schema.expensive_function(text)",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
      });
    });

    test("function with configuration parameters", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: `
          CREATE FUNCTION test_schema.config_function()
          RETURNS void
          LANGUAGE plpgsql
          SET work_mem = '256MB'
          SET statement_timeout = '30s'
          AS $$
          BEGIN
            -- Function with custom configuration
            RAISE NOTICE 'Function executed with custom config';
          END;
          $$;
        `,
        description: "function with configuration parameters",
        expectedSqlTerms: [
          "CREATE OR REPLACE FUNCTION test_schema.config_function()",
          "LANGUAGE plpgsql",
          "SET work_mem TO '256MB'",
          "SET statement_timeout TO '30s'",
        ],
        expectedMasterDependencies: [],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "function:test_schema.config_function()",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
      });
    });

    test("function used in table default", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: `
          CREATE FUNCTION test_schema.get_timestamp()
          RETURNS timestamp
          LANGUAGE sql
          STABLE
          AS 'SELECT NOW()';

          CREATE TABLE test_schema.events (
            id serial PRIMARY KEY,
            name text NOT NULL,
            created_at timestamp DEFAULT test_schema.get_timestamp()
          );
        `,
        description: "function used in table default",
        expectedSqlTerms: [
          "CREATE OR REPLACE FUNCTION test_schema.get_timestamp()",
          'CREATE TABLE "test_schema"."events"',
          "DEFAULT test_schema.get_timestamp()",
        ],
        expectedMasterDependencies: [],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "function:test_schema.get_timestamp()",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "table:test_schema.events",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "sequence:test_schema.events_id_seq",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "sequence:test_schema.events_id_seq",
            referenced_stable_id: "table:test_schema.events",
            deptype: "n",
          },
          {
            dependent_stable_id: "index:test_schema.events_pkey",
            referenced_stable_id: "constraint:test_schema.events.events_pkey",
            deptype: "i",
          },
          {
            dependent_stable_id: "constraint:test_schema.events.events_pkey",
            referenced_stable_id: "table:test_schema.events",
            deptype: "a",
          },
        ],
      });
    });

    test("function no changes when identical", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE FUNCTION test_schema.stable_function()
          RETURNS integer
          LANGUAGE sql
          AS 'SELECT 42';
        `,
        testSql: ``,
        description: "function no changes when identical",
        expectedSqlTerms: [],
        expectedMasterDependencies: [
          {
            dependent_stable_id: "function:test_schema.stable_function()",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "function:test_schema.stable_function()",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
      });
    });
  });

  // Function dependency ordering tests
  describe(`function dependency ordering (pg${pgVersion})`, () => {
    test("function before constraint that uses it", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: `
          CREATE FUNCTION test_schema.validate_email(email text)
          RETURNS boolean
          LANGUAGE sql
          IMMUTABLE
          AS $$
            SELECT email ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
          $$;

          CREATE TABLE test_schema.users (
            id serial PRIMARY KEY,
            name text NOT NULL,
            email text,
            CONSTRAINT valid_email CHECK (test_schema.validate_email(email))
          );
        `,
        description: "function before constraint that uses it",
        expectedSqlTerms: [
          "CREATE OR REPLACE FUNCTION test_schema.validate_email(email text)",
          'CREATE TABLE "test_schema"."users"',
          "CHECK (test_schema.validate_email(email))",
        ],
        expectedMasterDependencies: [],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "sequence:test_schema.users_id_seq",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "sequence:test_schema.users_id_seq",
            referenced_stable_id: "table:test_schema.users",
            deptype: "n",
          },
          {
            dependent_stable_id: "function:test_schema.validate_email(text)",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "index:test_schema.users_pkey",
            referenced_stable_id: "constraint:test_schema.users.users_pkey",
            deptype: "i",
          },
          {
            dependent_stable_id: "table:test_schema.users",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "constraint:test_schema.users.users_pkey",
            referenced_stable_id: "table:test_schema.users",
            deptype: "a",
          },
          {
            dependent_stable_id: "constraint:test_schema.users.valid_email",
            referenced_stable_id: "function:test_schema.validate_email(text)",
            deptype: "n",
          },
          {
            dependent_stable_id: "constraint:test_schema.users.valid_email",
            referenced_stable_id: "table:test_schema.users",
            deptype: "a",
          },
        ],
      });
    });

    test("function before view that uses it", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: `
          CREATE TABLE test_schema.products (
            id serial PRIMARY KEY,
            name text NOT NULL,
            price numeric(10,2)
          );

          CREATE FUNCTION test_schema.format_price(price numeric)
          RETURNS text
          LANGUAGE sql
          IMMUTABLE
          AS 'SELECT ''$'' || price::text';

          CREATE VIEW test_schema.product_display AS
          SELECT
            id,
            name,
            test_schema.format_price(price) as formatted_price
          FROM test_schema.products;
        `,
        description: "function before view that uses it",
        expectedSqlTerms: [
          'CREATE TABLE "test_schema"."products"',
          "CREATE OR REPLACE FUNCTION test_schema.format_price(price numeric)",
          'CREATE VIEW "test_schema"."product_display"',
          "test_schema.format_price(price)",
        ],
        expectedMasterDependencies: [],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "sequence:test_schema.products_id_seq",
            referenced_stable_id: "table:test_schema.products",
            deptype: "n",
          },
          {
            dependent_stable_id: "sequence:test_schema.products_id_seq",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "function:test_schema.format_price(numeric)",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "index:test_schema.products_pkey",
            referenced_stable_id:
              "constraint:test_schema.products.products_pkey",
            deptype: "i",
          },
          {
            dependent_stable_id: "table:test_schema.products",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id:
              "constraint:test_schema.products.products_pkey",
            referenced_stable_id: "table:test_schema.products",
            deptype: "a",
          },
          {
            dependent_stable_id: "view:test_schema.product_display",
            referenced_stable_id: "table:test_schema.products",
            deptype: "n",
          },
          {
            dependent_stable_id: "view:test_schema.product_display",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
      });
    });
  });

  // Complex function scenario test
  describe(`complex function scenarios (pg${pgVersion})`, () => {
    test("function with dependencies roundtrip", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: `
          -- Create a utility function first
          CREATE FUNCTION test_schema.safe_divide(numerator numeric, denominator numeric)
          RETURNS numeric
          LANGUAGE sql
          IMMUTABLE
          STRICT
          AS $$
            SELECT CASE
              WHEN denominator = 0 THEN NULL
              ELSE numerator / denominator
            END
          $$;

          -- Create tables that will use the function
          CREATE TABLE test_schema.metrics (
            id serial PRIMARY KEY,
            name text NOT NULL,
            total_value numeric DEFAULT 0,
            count_value integer DEFAULT 0
          );

          -- Create a view that uses the function
          CREATE VIEW test_schema.metric_averages AS
          SELECT
            id,
            name,
            test_schema.safe_divide(total_value, count_value::numeric) as average_value
          FROM test_schema.metrics
          WHERE count_value > 0;

          -- Create another function that depends on the first function
          CREATE FUNCTION test_schema.get_metric_summary(metric_id integer)
          RETURNS text
          LANGUAGE plpgsql
          STABLE
          AS $$
          DECLARE
            metric_name text;
            avg_val numeric;
          BEGIN
            SELECT m.name, test_schema.safe_divide(m.total_value, m.count_value::numeric)
            INTO metric_name, avg_val
            FROM test_schema.metrics m
            WHERE m.id = metric_id;

            RETURN metric_name || ': ' || COALESCE(avg_val::text, 'N/A');
          END;
          $$;
        `,
        description: "Complex function scenario with multiple dependencies",
        expectedSqlTerms: [
          "CREATE OR REPLACE FUNCTION test_schema.safe_divide(numerator numeric, denominator numeric)",
          'CREATE TABLE "test_schema"."metrics"',
          'CREATE VIEW "test_schema"."metric_averages"',
          "CREATE OR REPLACE FUNCTION test_schema.get_metric_summary(metric_id integer)",
          "test_schema.safe_divide(total_value, (count_value)::numeric)",
          "test_schema.safe_divide(m.total_value, m.count_value::numeric)",
        ],
        expectedMasterDependencies: [],
        expectedBranchDependencies: [
          {
            dependent_stable_id:
              "function:test_schema.safe_divide(numeric,numeric)",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "table:test_schema.metrics",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "sequence:test_schema.metrics_id_seq",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "sequence:test_schema.metrics_id_seq",
            referenced_stable_id: "table:test_schema.metrics",
            deptype: "n",
          },
          {
            dependent_stable_id: "index:test_schema.metrics_pkey",
            referenced_stable_id: "constraint:test_schema.metrics.metrics_pkey",
            deptype: "i",
          },
          {
            dependent_stable_id: "constraint:test_schema.metrics.metrics_pkey",
            referenced_stable_id: "table:test_schema.metrics",
            deptype: "a",
          },
          {
            dependent_stable_id: "view:test_schema.metric_averages",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "view:test_schema.metric_averages",
            referenced_stable_id: "table:test_schema.metrics",
            deptype: "n",
          },
          {
            dependent_stable_id:
              "function:test_schema.get_metric_summary(integer)",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
      });
    });
  });
}
