/**
 * Integration tests for PostgreSQL RLS (Row Level Security) operations.
 */

import { describe } from "vitest";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { getTest } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTest(pgVersion);

  // TODO: Fix RLS and policy dependency detection issues
  describe.skip(`RLS operations (pg${pgVersion})`, () => {
    test("enable RLS on table", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA app;
          CREATE TABLE app.users (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL
          );
        `,
        testSql: `
          ALTER TABLE app.users ENABLE ROW LEVEL SECURITY;
        `,
        description: "enable RLS on table",
        expectedSqlTerms: [`ALTER TABLE app.users ENABLE ROW LEVEL SECURITY`],
        expectedMasterDependencies: [
          {
            dependent_stable_id: "table:app.users",
            referenced_stable_id: "schema:app",
            deptype: "n",
          },
          {
            dependent_stable_id: "constraint:app.users.users_email_key",
            referenced_stable_id: "table:app.users",
            deptype: "a",
          },
          {
            dependent_stable_id: "constraint:app.users.users_pkey",
            referenced_stable_id: "table:app.users",
            deptype: "a",
          },
          {
            dependent_stable_id: "index:app.users_email_key",
            referenced_stable_id: "constraint:app.users.users_email_key",
            deptype: "i",
          },
          {
            dependent_stable_id: "index:app.users_pkey",
            referenced_stable_id: "constraint:app.users.users_pkey",
            deptype: "i",
          },
        ],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "table:app.users",
            referenced_stable_id: "schema:app",
            deptype: "n",
          },
          {
            dependent_stable_id: "constraint:app.users.users_email_key",
            referenced_stable_id: "table:app.users",
            deptype: "a",
          },
          {
            dependent_stable_id: "constraint:app.users.users_pkey",
            referenced_stable_id: "table:app.users",
            deptype: "a",
          },
          {
            dependent_stable_id: "index:app.users_email_key",
            referenced_stable_id: "constraint:app.users.users_email_key",
            deptype: "i",
          },
          {
            dependent_stable_id: "index:app.users_pkey",
            referenced_stable_id: "constraint:app.users.users_pkey",
            deptype: "i",
          },
        ],
      });
    });

    test("disable RLS on table", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA app;
          CREATE TABLE app.users (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL
          );
          ALTER TABLE app.users ENABLE ROW LEVEL SECURITY;
        `,
        testSql: `
          ALTER TABLE app.users DISABLE ROW LEVEL SECURITY;
        `,
        description: "disable RLS on table",
        expectedSqlTerms: [`ALTER TABLE app.users DISABLE ROW LEVEL SECURITY`],
        expectedMasterDependencies: [
          {
            dependent_stable_id: "table:app.users",
            referenced_stable_id: "schema:app",
            deptype: "n",
          },
          {
            dependent_stable_id: "constraint:app.users.users_email_key",
            referenced_stable_id: "table:app.users",
            deptype: "a",
          },
          {
            dependent_stable_id: "constraint:app.users.users_pkey",
            referenced_stable_id: "table:app.users",
            deptype: "a",
          },
          {
            dependent_stable_id: "index:app.users_email_key",
            referenced_stable_id: "constraint:app.users.users_email_key",
            deptype: "i",
          },
          {
            dependent_stable_id: "index:app.users_pkey",
            referenced_stable_id: "constraint:app.users.users_pkey",
            deptype: "i",
          },
        ],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "table:app.users",
            referenced_stable_id: "schema:app",
            deptype: "n",
          },
          {
            dependent_stable_id: "constraint:app.users.users_email_key",
            referenced_stable_id: "table:app.users",
            deptype: "a",
          },
          {
            dependent_stable_id: "constraint:app.users.users_pkey",
            referenced_stable_id: "table:app.users",
            deptype: "a",
          },
          {
            dependent_stable_id: "index:app.users_email_key",
            referenced_stable_id: "constraint:app.users.users_email_key",
            deptype: "i",
          },
          {
            dependent_stable_id: "index:app.users_pkey",
            referenced_stable_id: "constraint:app.users.users_pkey",
            deptype: "i",
          },
        ],
      });
    });
  });
}
