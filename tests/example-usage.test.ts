/**
 * Example usage of the three different test utilities
 */

import { describe } from "vitest";
import { POSTGRES_VERSIONS } from "./constants.ts";
import {
  getTest,
  getTestIsolated,
  getTestWithSupabaseIsolated,
} from "./utils.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  describe.skip.concurrent(`test utilities demo (pg${pgVersion})`, () => {
    const test = getTest(pgVersion);
    const testIsolated = getTestIsolated(pgVersion);
    const testWithSupabase = getTestWithSupabaseIsolated(pgVersion);

    test("fast pooled test - uses shared Alpine containers with database isolation", async ({
      db,
    }) => {
      // This is the fastest option - uses a pool of Alpine PostgreSQL containers
      // and creates/drops databases for isolation instead of creating new containers
      await db.a`CREATE TABLE test_table (id SERIAL PRIMARY KEY, name TEXT)`;
      await db.a`INSERT INTO test_table (name) VALUES ('test')`;

      // Just a simple test to verify the setup works
    });

    testIsolated(
      "isolated test - creates fresh Alpine containers for each database",
      async ({ db }) => {
        // This creates brand new Alpine PostgreSQL containers for complete isolation
        // Slower than pooled but faster than Supabase containers
        await db.a`CREATE TABLE isolated_table (id SERIAL PRIMARY KEY, data TEXT)`;
        await db.a`INSERT INTO isolated_table (data) VALUES ('isolated')`;

        // Just a simple test to verify the setup works
      },
    );

    testWithSupabase(
      "supabase test - for tests requiring Supabase features with full isolation betwen databases",
      async ({ db }) => {
        // This uses Supabase PostgreSQL containers with all extensions
        // Slowest but has all Supabase-specific functionality
        await db.a`CREATE TABLE supabase_table (id SERIAL PRIMARY KEY, content TEXT)`;
        await db.a`INSERT INTO supabase_table (content) VALUES ('supabase')`;

        // Just a simple test to verify the setup works
      },
    );
  });
}
