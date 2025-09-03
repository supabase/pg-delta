/**
 * Integration tests for PostgreSQL function operations.
 */

import { describe } from "vitest";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { getTest } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTest(pgVersion);

  // TODO: Fix function dependency detection issues
  describe.skip(`function operations (pg${pgVersion})`, () => {
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
  });
}
