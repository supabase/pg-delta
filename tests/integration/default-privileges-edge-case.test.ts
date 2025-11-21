/**
 * Integration test for default privileges edge case with Supabase roles.
 *
 * This test covers a specific edge case where:
 * 1. Default privileges are set to grant all on tables to postgres, anon, authenticated, service_role
 * 2. A user creates a table and explicitly revokes access from anon role
 * 3. When diffing against an empty database, the tool should account for default privileges
 *    and not generate grants that would conflict with the user's intent
 */

import dedent from "dedent";
import { describe } from "vitest";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { roundtripFidelityTest } from "../integration/roundtrip.ts";
import { getTestIsolated } from "../utils.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTestIsolated(pgVersion);

  describe.concurrent(`default privileges edge case (pg${pgVersion})`, () => {
    test("table revoke a privilege that is granted by default", async ({
      db,
    }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          -- Create Supabase roles (simulating Supabase environment)
          CREATE ROLE anon;
          CREATE ROLE authenticated;
          CREATE ROLE service_role;
          
          -- Set up default privileges for all new tables in public schema
          -- This simulates Supabase's default behavior
          ALTER DEFAULT PRIVILEGES IN SCHEMA public 
            GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
          CREATE TABLE public.test (
            id integer PRIMARY KEY,
            data text
          );
        `,
        testSql: `
          REVOKE ALL ON public.test FROM anon;
        `,
        expectedSqlTerms: ["REVOKE ALL ON public.test FROM anon"],
      });
    });
    // This test verifies that when a user creates a table and explicitly revokes
    // access from the anon role, the diff tool correctly accounts for default
    // privileges and doesn't generate conflicting grants.
    // Expected behavior:
    // - The table should be created
    // - The anon role should be explicitly revoked (not just omitted)
    // - The authenticated and service_role should retain their grants
    // - The generated SQL should reflect the user's intent, not just the
    //   current privilege state
    test("table creation with anon role revocation should account for default privileges", async ({
      db,
    }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          -- Create Supabase roles (simulating Supabase environment)
          CREATE ROLE anon;
          CREATE ROLE authenticated;
          CREATE ROLE service_role;
          
          -- Set up default privileges for all new tables in public schema
          -- This simulates Supabase's default behavior
          ALTER DEFAULT PRIVILEGES IN SCHEMA public 
            GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
        `,
        testSql: `
          -- User creates a table and explicitly revokes anon access
          -- This represents the user's desired state
          CREATE TABLE public.test (
            id integer PRIMARY KEY,
            data text
          );
          
          REVOKE ALL ON public.test FROM anon;
        `,
        expectedSqlTerms: [
          "CREATE TABLE public.test (id integer NOT NULL, data text)",
          "ALTER TABLE public.test ADD CONSTRAINT test_pkey PRIMARY KEY (id)",
          "REVOKE ALL ON public.test FROM anon",
        ],
      });
    });

    test("table creation with multiple role revocations should handle default privileges correctly", async ({
      db,
    }) => {
      // This test verifies that when a user creates a table and revokes access
      // from multiple roles that have default privileges, the diff tool correctly
      // handles the explicit revocations.
      // Expected behavior:
      // - The table should be created
      // - Both anon and authenticated roles should be explicitly revoked
      // - Only service_role should retain access (along with postgres)
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          -- Create Supabase roles
          CREATE ROLE anon;
          CREATE ROLE authenticated;
          CREATE ROLE service_role;
          
          -- Set up default privileges
          ALTER DEFAULT PRIVILEGES IN SCHEMA public 
            GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
        `,
        testSql: `
          -- User creates a table and revokes access from both anon and authenticated
          CREATE TABLE public.restricted_table (
            id integer PRIMARY KEY,
            sensitive_data text
          );
          
          REVOKE ALL ON public.restricted_table FROM anon;
          REVOKE ALL ON public.restricted_table FROM authenticated;
        `,
        expectedSqlTerms: [
          "CREATE TABLE public.restricted_table (id integer NOT NULL, sensitive_data text)",
          "ALTER TABLE public.restricted_table ADD CONSTRAINT restricted_table_pkey PRIMARY KEY (id)",
          "REVOKE ALL ON public.restricted_table FROM anon",
          "REVOKE ALL ON public.restricted_table FROM authenticated",
        ],
      });
    });

    test("table creation with selective privilege grants should override default privileges", async ({
      db,
    }) => {
      // This test verifies that when a user creates a table and wants to override
      // default privileges with specific grants, the diff tool correctly generates
      // the explicit privilege statements.

      // Expected behavior:
      // - The table should be created
      // - All roles should be explicitly revoked first
      // - Then specific grants should be applied
      // - The generated SQL should reflect the selective privilege model
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          -- Create Supabase roles
          CREATE ROLE anon;
          CREATE ROLE authenticated;
          CREATE ROLE service_role;
          
          -- Set up default privileges
          ALTER DEFAULT PRIVILEGES IN SCHEMA public 
            GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
        `,
        testSql: `
          -- User creates a table and grants only specific privileges
          CREATE TABLE public.selective_table (
            id integer PRIMARY KEY,
            public_data text,
            private_data text
          );
          
          -- Revoke all first, then grant only what's needed
          REVOKE ALL ON public.selective_table FROM anon;
          REVOKE ALL ON public.selective_table FROM authenticated;
          REVOKE ALL ON public.selective_table FROM service_role;
          
          -- Grant only SELECT to authenticated users
          GRANT SELECT ON public.selective_table TO authenticated;
          
          -- Grant full access to service_role
          GRANT ALL ON public.selective_table TO service_role;
        `,
        expectedSqlTerms: [
          "CREATE TABLE public.selective_table (id integer NOT NULL, public_data text, private_data text)",
          "ALTER TABLE public.selective_table ADD CONSTRAINT selective_table_pkey PRIMARY KEY (id)",
          "REVOKE ALL ON public.selective_table FROM anon",
          pgVersion <= 15
            ? "REVOKE DELETE, INSERT, REFERENCES, TRIGGER, TRUNCATE, UPDATE ON public.selective_table FROM authenticated"
            : "REVOKE DELETE, INSERT, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE, UPDATE ON public.selective_table FROM authenticated",
        ],
      });
    });

    test("default privileges edge case with schema-specific setup", async ({
      db,
    }) => {
      // This test verifies that the default privileges edge case works correctly
      // with custom schemas, not just the public schema.
      // Expected behavior:
      // - The table should be created in the app schema
      // - The anon role should be explicitly revoked
      // - Other roles should retain their default privileges
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          -- Create Supabase roles
          CREATE ROLE anon;
          CREATE ROLE authenticated;
          CREATE ROLE service_role;
          
          -- Create a custom schema
          CREATE SCHEMA app;
          
          -- Set up default privileges for the custom schema
          ALTER DEFAULT PRIVILEGES IN SCHEMA app 
            GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
        `,
        testSql: `
          -- User creates a table in custom schema and revokes anon access
          CREATE TABLE app.user_data (
            id integer PRIMARY KEY,
            username text UNIQUE NOT NULL,
            email text
          );
          
          REVOKE ALL ON app.user_data FROM anon;
        `,
        expectedSqlTerms: [
          "CREATE TABLE app.user_data (id integer NOT NULL, username text NOT NULL, email text)",
          "ALTER TABLE app.user_data ADD CONSTRAINT user_data_pkey PRIMARY KEY (id)",
          "ALTER TABLE app.user_data ADD CONSTRAINT user_data_username_key UNIQUE (username)",
          "REVOKE ALL ON app.user_data FROM anon",
        ],
      });
    });

    test("altering default privileges ensures correct final state regardless of creation order", async ({
      db,
    }) => {
      // This test verifies that when default privileges are altered, the migration script
      // correctly generates SQL to reach the final desired state, regardless of the order
      // operations were performed in the branch database.
      //
      // The migration script runs ALTER DEFAULT PRIVILEGES before CREATE (via constraint spec),
      // so all created objects use the final default privileges state. The script doesn't
      // need to reproduce the exact sequence from the branch - it just needs to ensure
      // the final state matches.
      //
      // Expected behavior:
      // - ALTER DEFAULT PRIVILEGES runs before CREATE (via constraint spec)
      // - Both tables are created with final defaults (no anon)
      // - No REVOKE statements needed since final state already matches
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          -- Create Supabase roles
          CREATE ROLE anon;
          CREATE ROLE authenticated;
          CREATE ROLE service_role;
          
          -- Set up initial default privileges
          ALTER DEFAULT PRIVILEGES IN SCHEMA public 
            GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
        `,
        testSql: `
          -- Create first table (gets initial defaults: ALL to anon)
          CREATE TABLE public.first_table (
            id integer PRIMARY KEY,
            data text
          );
          
          -- Alter default privileges to remove anon access
          ALTER DEFAULT PRIVILEGES IN SCHEMA public 
            REVOKE ALL ON TABLES FROM anon;
          
          -- Create second table (gets final defaults: no anon)
          CREATE TABLE public.second_table (
            id integer PRIMARY KEY,
            data text
          );
          
          -- Explicitly revoke from first table to match desired final state
          REVOKE ALL ON public.first_table FROM anon;
        `,
        expectedSqlTerms: [
          "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon",
          "CREATE TABLE public.first_table (id integer NOT NULL, data text)",
          "ALTER TABLE public.first_table ADD CONSTRAINT first_table_pkey PRIMARY KEY (id)",
          "CREATE TABLE public.second_table (id integer NOT NULL, data text)",
          "ALTER TABLE public.second_table ADD CONSTRAINT second_table_pkey PRIMARY KEY (id)",
          // Note: Since ALTER DEFAULT PRIVILEGES runs before CREATE (via constraint spec),
          // both tables are created with final defaults (no anon), which matches the branch state.
          // No REVOKE statements are needed because the final state is already correct.
        ],
      });
    });

    test("view creation with anon role revocation should account for default privileges", async ({
      db,
    }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          -- Create Supabase roles
          CREATE ROLE anon;
          CREATE ROLE authenticated;
          CREATE ROLE service_role;
          
          -- Set up default privileges for views
          ALTER DEFAULT PRIVILEGES IN SCHEMA public 
            GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
        `,
        testSql: `
          -- User creates a view and explicitly revokes anon access
          CREATE VIEW public.test_view AS SELECT 1 AS id;
          
          REVOKE ALL ON public.test_view FROM anon;
        `,
        expectedSqlTerms: [
          "CREATE VIEW public.test_view AS SELECT 1 AS id",
          "REVOKE ALL ON public.test_view FROM anon",
        ],
      });
    });

    test("sequence creation with anon role revocation should account for default privileges", async ({
      db,
    }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          -- Create Supabase roles
          CREATE ROLE anon;
          CREATE ROLE authenticated;
          CREATE ROLE service_role;
          
          -- Set up default privileges for sequences
          ALTER DEFAULT PRIVILEGES IN SCHEMA public 
            GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
        `,
        testSql: `
          -- User creates a sequence and explicitly revokes anon access
          CREATE SEQUENCE public.test_seq;
          
          REVOKE ALL ON public.test_seq FROM anon;
        `,
        expectedSqlTerms: [
          "CREATE SEQUENCE public.test_seq",
          "REVOKE ALL ON SEQUENCE public.test_seq FROM anon",
        ],
      });
    });

    test("materialized view creation with anon role revocation should account for default privileges", async ({
      db,
    }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          -- Create Supabase roles
          CREATE ROLE anon;
          CREATE ROLE authenticated;
          CREATE ROLE service_role;
          
          -- Set up default privileges for materialized views
          ALTER DEFAULT PRIVILEGES IN SCHEMA public 
            GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
        `,
        testSql: `
          -- User creates a materialized view and explicitly revokes anon access
          CREATE MATERIALIZED VIEW public.test_mv AS SELECT 1 AS id;
          
          REVOKE ALL ON public.test_mv FROM anon;
        `,
        expectedSqlTerms: [
          "CREATE MATERIALIZED VIEW public.test_mv AS SELECT 1 AS id WITH DATA",
          "REVOKE ALL ON public.test_mv FROM anon",
        ],
      });
    });

    test("procedure creation with anon role revocation should account for default privileges", async ({
      db,
    }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          -- Create Supabase roles
          CREATE ROLE anon;
          CREATE ROLE authenticated;
          CREATE ROLE service_role;
          
          -- Set up default privileges for functions/procedures
          ALTER DEFAULT PRIVILEGES IN SCHEMA public 
            GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;
        `,
        testSql: dedent`
          -- User creates a procedure and explicitly revokes anon access
          CREATE PROCEDURE public.test_proc()
          LANGUAGE sql
          AS $$ SELECT 1; $$;
          
          REVOKE ALL ON PROCEDURE public.test_proc() FROM anon;
        `,
        expectedSqlTerms: [
          "CREATE PROCEDURE public.test_proc()\n LANGUAGE sql\nAS $procedure$ SELECT 1; $procedure$",
          "REVOKE ALL ON PROCEDURE public.test_proc() FROM anon",
        ],
      });
    });

    test("aggregate creation with anon role revocation should account for default privileges", async ({
      db,
    }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          -- Create Supabase roles
          CREATE ROLE anon;
          CREATE ROLE authenticated;
          CREATE ROLE service_role;
          
          -- Set up default privileges for functions/aggregates
          ALTER DEFAULT PRIVILEGES IN SCHEMA public 
            GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;
        `,
        testSql: `
          -- User creates an aggregate and explicitly revokes anon access
          CREATE AGGREGATE public.test_agg(int) (
            SFUNC = int4pl,
            STYPE = int
          );
          
          REVOKE ALL ON FUNCTION public.test_agg(int) FROM anon;
        `,
        expectedSqlTerms: [
          "CREATE AGGREGATE public.test_agg(integer) (SFUNC = int4pl, STYPE = integer)",
          "REVOKE ALL ON FUNCTION public.test_agg(integer) FROM anon",
        ],
      });
    });

    test("schema creation with anon role revocation should account for default privileges", async ({
      db,
    }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          -- Create Supabase roles
          CREATE ROLE anon;
          CREATE ROLE authenticated;
          CREATE ROLE service_role;
          
          -- Set up default privileges for schemas (global, not schema-specific)
          ALTER DEFAULT PRIVILEGES 
            GRANT ALL ON SCHEMAS TO postgres, anon, authenticated, service_role;
        `,
        testSql: `
          -- User creates a schema and explicitly revokes anon access
          CREATE SCHEMA test_schema;
          
          REVOKE ALL ON SCHEMA test_schema FROM anon;
        `,
        expectedSqlTerms: [
          "CREATE SCHEMA test_schema AUTHORIZATION postgres",
          "REVOKE ALL ON SCHEMA test_schema FROM anon",
        ],
      });
    });

    test("domain creation with anon role revocation should account for default privileges", async ({
      db,
    }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          -- Create Supabase roles
          CREATE ROLE anon;
          CREATE ROLE authenticated;
          CREATE ROLE service_role;
          
          -- Set up default privileges for types/domains
          ALTER DEFAULT PRIVILEGES IN SCHEMA public 
            GRANT ALL ON TYPES TO postgres, anon, authenticated, service_role;
        `,
        testSql: `
          -- User creates a domain and explicitly revokes anon access
          CREATE DOMAIN public.test_domain AS integer;
          
          REVOKE ALL ON DOMAIN public.test_domain FROM anon;
        `,
        expectedSqlTerms: [
          "CREATE DOMAIN public.test_domain AS integer",
          "REVOKE ALL ON DOMAIN public.test_domain FROM anon",
        ],
      });
    });

    test("enum creation with anon role revocation should account for default privileges", async ({
      db,
    }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          -- Create Supabase roles
          CREATE ROLE anon;
          CREATE ROLE authenticated;
          CREATE ROLE service_role;
          
          -- Set up default privileges for types/enums
          ALTER DEFAULT PRIVILEGES IN SCHEMA public 
            GRANT ALL ON TYPES TO postgres, anon, authenticated, service_role;
        `,
        testSql: `
          -- User creates an enum and explicitly revokes anon access
          CREATE TYPE public.test_enum AS ENUM ('value1', 'value2');
          
          REVOKE ALL ON TYPE public.test_enum FROM anon;
        `,
        expectedSqlTerms: [
          "CREATE TYPE public.test_enum AS ENUM ('value1', 'value2')",
          "REVOKE ALL ON TYPE public.test_enum FROM anon",
        ],
      });
    });

    test("composite type creation with anon role revocation should account for default privileges", async ({
      db,
    }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          -- Create Supabase roles
          CREATE ROLE anon;
          CREATE ROLE authenticated;
          CREATE ROLE service_role;
          
          -- Set up default privileges for types/composite types
          ALTER DEFAULT PRIVILEGES IN SCHEMA public 
            GRANT ALL ON TYPES TO postgres, anon, authenticated, service_role;
        `,
        testSql: `
          -- User creates a composite type and explicitly revokes anon access
          CREATE TYPE public.test_composite AS (
            field1 integer,
            field2 text
          );
          
          REVOKE ALL ON TYPE public.test_composite FROM anon;
        `,
        expectedSqlTerms: [
          "CREATE TYPE public.test_composite AS (field1 integer, field2 text)",
          "REVOKE ALL ON TYPE public.test_composite FROM anon",
          "REVOKE ALL ON TYPE public.test_composite FROM authenticated",
          "REVOKE ALL ON TYPE public.test_composite FROM service_role",
        ],
      });
    });

    test("range type creation with anon role revocation should account for default privileges", async ({
      db,
    }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          -- Create Supabase roles
          CREATE ROLE anon;
          CREATE ROLE authenticated;
          CREATE ROLE service_role;
          
          -- Set up default privileges for types/range types
          ALTER DEFAULT PRIVILEGES IN SCHEMA public 
            GRANT ALL ON TYPES TO postgres, anon, authenticated, service_role;
        `,
        testSql: `
          -- User creates a range type and explicitly revokes anon access
          CREATE TYPE public.test_range AS RANGE (SUBTYPE = int4);
          
          REVOKE ALL ON TYPE public.test_range FROM anon;
        `,
        expectedSqlTerms: [
          "CREATE TYPE public.test_range AS RANGE (SUBTYPE = integer)",
          "REVOKE ALL ON TYPE public.test_range FROM anon",
        ],
      });
    });
  });
}
