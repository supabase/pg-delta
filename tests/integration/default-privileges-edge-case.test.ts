/**
 * Integration test for default privileges edge case with Supabase roles.
 *
 * This test covers a specific edge case where:
 * 1. Default privileges are set to grant all on tables to postgres, anon, authenticated, service_role
 * 2. A user creates a table and explicitly revokes access from anon role
 * 3. When diffing against an empty database, the tool should account for default privileges
 *    and not generate grants that would conflict with the user's intent
 */

import { describe } from "vitest";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { roundtripFidelityTest } from "../integration/roundtrip.ts";
import { getTestIsolated } from "../utils.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTestIsolated(pgVersion);

  describe(`default privileges edge case (pg${pgVersion})`, () => {
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
    test.only("table creation with anon role revocation should account for default privileges", async ({
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
          "REVOKE ALL ON public.selective_table FROM authenticated",
          "REVOKE ALL ON public.selective_table FROM service_role",
          "GRANT SELECT ON public.selective_table TO authenticated",
          "GRANT ALL ON public.selective_table TO service_role",
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
          "REVOKE ALL ON app.user_data FROM anon",
        ],
      });
    });
  });
}
