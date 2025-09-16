/**
 * Integration tests for PostgreSQL function operations.
 */

import dedent from "dedent";
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
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: dedent`
          CREATE FUNCTION test_schema.add_numbers(a integer, b integer)
           RETURNS integer
           LANGUAGE sql
           IMMUTABLE
          AS $function$SELECT $1 + $2$function$;
        `,
      });
    });

    test("plpgsql function with security definer", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: dedent`
          CREATE FUNCTION test_schema.get_user_count()
           RETURNS bigint
           LANGUAGE plpgsql
           STABLE SECURITY DEFINER
          AS $function$
          BEGIN
            RETURN (SELECT COUNT(*) FROM pg_catalog.pg_user);
          END;
          $function$;
        `,
      });
    });

    test("function replacement", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE FUNCTION test_schema.version_function()
          RETURNS text
          LANGUAGE sql
          IMMUTABLE
          AS 'SELECT ''v1.0''';
        `,
        testSql: dedent`
        CREATE OR REPLACE FUNCTION test_schema.version_function()
         RETURNS text
         LANGUAGE sql
         IMMUTABLE
        AS $function$SELECT 'v2.0'$function$;
      `,
      });
    });

    test("function overloading", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: dedent`
          CREATE FUNCTION test_schema.format_value(input_val integer)
           RETURNS text
           LANGUAGE sql
           IMMUTABLE
          AS $function$SELECT input_val::text$function$;

          CREATE FUNCTION test_schema.format_value(input_val integer, prefix text)
           RETURNS text
           LANGUAGE sql
           IMMUTABLE
          AS $function$SELECT prefix || input_val::text$function$;
        `,
      });
    });

    test("drop function", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE FUNCTION test_schema.temp_function()
          RETURNS text
          LANGUAGE sql
          AS 'SELECT ''temporary''';
        `,
        testSql: dedent`
          DROP FUNCTION test_schema.temp_function();
        `,
      });
    });

    test("function with complex attributes", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: dedent`
          CREATE FUNCTION test_schema.expensive_function(input_data text)
           RETURNS text
           LANGUAGE plpgsql
           PARALLEL RESTRICTED STRICT COST 1000
          AS $function$
          BEGIN
            -- Simulate expensive operation
            PERFORM pg_sleep(0.1);
            RETURN upper(input_data);
          END;
          $function$;
        `,
      });
    });

    test("function with configuration parameters", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: dedent`
          CREATE FUNCTION test_schema.config_function()
           RETURNS void
           LANGUAGE plpgsql
           SET work_mem TO '256MB'
           SET statement_timeout TO '30s'
          AS $function$
          BEGIN
            -- Function with custom configuration
            RAISE NOTICE 'Function executed with custom config';
          END;
          $function$;
        `,
      });
    });

    test("function used in table default", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: dedent`
          CREATE FUNCTION test_schema.get_timestamp()
           RETURNS timestamp with time zone
           LANGUAGE sql
           STABLE
          AS $function$SELECT NOW()$function$;

          CREATE TABLE test_schema.events (created_at timestamp with time zone DEFAULT test_schema.get_timestamp());
        `,
      });
    });

    test("function no changes when identical", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE FUNCTION test_schema.stable_function()
          RETURNS integer
          LANGUAGE sql
          AS 'SELECT 42';
        `,
        testSql: ``,
      });
    });
  });

  // Function dependency ordering tests
  describe(`function dependency ordering (pg${pgVersion})`, () => {
    test("function before constraint that uses it", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: dedent`
          CREATE FUNCTION test_schema.validate_email(email text)
           RETURNS boolean
           LANGUAGE sql
           IMMUTABLE
          AS $function$
           SELECT email ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$'
          $function$;

          CREATE TABLE test_schema.users (email text);

          ALTER TABLE test_schema.users ADD CONSTRAINT valid_email CHECK (test_schema.validate_email(email));
        `,
      });
    });

    test("function before view that uses it", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: dedent`
          CREATE TABLE test_schema.products (price numeric(10,2));

          CREATE FUNCTION test_schema.format_price(price numeric)
           RETURNS text
           LANGUAGE sql
           IMMUTABLE
          AS $function$SELECT '$' || price::text$function$;

          CREATE VIEW test_schema.product_display AS SELECT test_schema.format_price(price) AS formatted_price
          FROM test_schema.products;
        `,
      });
    });
  });

  // Complex function scenario test
  describe(`complex function scenarios (pg${pgVersion})`, () => {
    test("function with dependencies roundtrip", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: dedent`
          CREATE TABLE test_schema.metrics (name text NOT NULL, total_value numeric DEFAULT 0, count_value integer DEFAULT 0);
        
          CREATE FUNCTION test_schema.safe_divide(numerator numeric, denominator numeric)
           RETURNS numeric
           LANGUAGE sql
           IMMUTABLE STRICT
          AS $function$
            SELECT CASE
              WHEN denominator = 0 THEN NULL
              ELSE numerator / denominator
            END
          $function$;

          CREATE VIEW test_schema.metric_averages AS SELECT name,
              test_schema.safe_divide(total_value, (count_value)::numeric) AS average_value
             FROM test_schema.metrics
            WHERE (count_value > 0);

          CREATE FUNCTION test_schema.get_metric_summary(metric_id integer)
           RETURNS text
           LANGUAGE plpgsql
           STABLE
          AS $function$
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
          $function$;
        `,
      });
    });
  });
}
