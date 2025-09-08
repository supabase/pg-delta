/**
 * Integration tests for PostgreSQL policy dependencies.
 */

import { describe } from "vitest";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { getTest } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTest(pgVersion);

  // TODO: Fix policy dependency detection issues
  describe.concurrent(`policy dependencies (pg${pgVersion})`, () => {
    test("policy depends on table", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA security;
          CREATE TABLE security.users (
            id INTEGER PRIMARY KEY,
            username TEXT NOT NULL,
            email TEXT UNIQUE
          );
        `,
        testSql: `
          ALTER TABLE security.users ENABLE ROW LEVEL SECURITY;
          CREATE POLICY user_isolation ON security.users
            FOR ALL
            TO public
            USING (true);
        `,
        description: "policy depends on table",
        expectedSqlTerms: [
          "ALTER TABLE",
          "ENABLE ROW LEVEL SECURITY",
          "CREATE POLICY",
          "user_isolation",
          '"security"."users"',
          "FOR ALL",
          "TO public",
          "USING",
          "true",
        ],
        expectedMasterDependencies: [
          {
            dependent_stable_id: "table:security.users",
            referenced_stable_id: "schema:security",
            deptype: "n",
          },
          {
            dependent_stable_id: "constraint:security.users.users_pkey",
            referenced_stable_id: "table:security.users",
            deptype: "a",
          },
          {
            dependent_stable_id: "index:security.users_pkey",
            referenced_stable_id: "constraint:security.users.users_pkey",
            deptype: "i",
          },
          {
            dependent_stable_id: "constraint:security.users.users_email_key",
            referenced_stable_id: "table:security.users",
            deptype: "a",
          },
          {
            dependent_stable_id: "index:security.users_email_key",
            referenced_stable_id: "constraint:security.users.users_email_key",
            deptype: "i",
          },
        ],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "table:security.users",
            referenced_stable_id: "schema:security",
            deptype: "n",
          },
          {
            dependent_stable_id: "constraint:security.users.users_pkey",
            referenced_stable_id: "table:security.users",
            deptype: "a",
          },
          {
            dependent_stable_id: "index:security.users_pkey",
            referenced_stable_id: "constraint:security.users.users_pkey",
            deptype: "i",
          },
          {
            dependent_stable_id: "constraint:security.users.users_email_key",
            referenced_stable_id: "table:security.users",
            deptype: "a",
          },
          {
            dependent_stable_id: "index:security.users_email_key",
            referenced_stable_id: "constraint:security.users.users_email_key",
            deptype: "i",
          },
          {
            dependent_stable_id: "policy:security.users.user_isolation",
            referenced_stable_id: "table:security.users",
            deptype: "n",
          },
        ],
      });
    });

    test("multiple policies with dependencies", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA app;
          CREATE TABLE app.posts (
            id INTEGER PRIMARY KEY,
            title TEXT NOT NULL,
            content TEXT,
            author_id INTEGER NOT NULL,
            published BOOLEAN DEFAULT false
          );
        `,
        testSql: `
          ALTER TABLE app.posts ENABLE ROW LEVEL SECURITY;

          -- Read policy for all users
          CREATE POLICY read_posts ON app.posts
            FOR SELECT
            TO public
            USING (published = true);

          -- Insert policy for authenticated users
          CREATE POLICY insert_own_posts ON app.posts
            FOR INSERT
            TO public
            WITH CHECK (true);

          -- Update policy for authors
          CREATE POLICY update_own_posts ON app.posts
            FOR UPDATE
            TO public
            USING (true)
            WITH CHECK (true);
        `,
        description: "multiple policies with dependencies",
        expectedSqlTerms: [
          "ALTER TABLE",
          "ENABLE ROW LEVEL SECURITY",
          "CREATE POLICY",
          "read_posts",
          "insert_own_posts",
          "update_own_posts",
          '"app"."posts"',
          "FOR SELECT",
          "FOR INSERT",
          "FOR UPDATE",
          "TO public",
          "TO public",
          "USING",
          "WITH CHECK",
          "published = true",
          "true",
        ],
        expectedMasterDependencies: [
          {
            dependent_stable_id: "table:app.posts",
            referenced_stable_id: "schema:app",
            deptype: "n",
          },
          {
            dependent_stable_id: "constraint:app.posts.posts_pkey",
            referenced_stable_id: "table:app.posts",
            deptype: "a",
          },
          {
            dependent_stable_id: "index:app.posts_pkey",
            referenced_stable_id: "constraint:app.posts.posts_pkey",
            deptype: "i",
          },
        ],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "table:app.posts",
            referenced_stable_id: "schema:app",
            deptype: "n",
          },
          {
            dependent_stable_id: "constraint:app.posts.posts_pkey",
            referenced_stable_id: "table:app.posts",
            deptype: "a",
          },
          {
            dependent_stable_id: "index:app.posts_pkey",
            referenced_stable_id: "constraint:app.posts.posts_pkey",
            deptype: "i",
          },
          {
            dependent_stable_id: "policy:app.posts.read_posts",
            referenced_stable_id: "table:app.posts",
            deptype: "n",
          },
          {
            dependent_stable_id: "policy:app.posts.insert_own_posts",
            referenced_stable_id: "table:app.posts",
            deptype: "n",
          },
          {
            dependent_stable_id: "policy:app.posts.update_own_posts",
            referenced_stable_id: "table:app.posts",
            deptype: "n",
          },
        ],
      });
    });

    test("create table and policy together", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA tenant;
        `,
        testSql: `
          CREATE TABLE tenant.data (
            id INTEGER PRIMARY KEY,
            tenant_id INTEGER NOT NULL,
            content TEXT NOT NULL,
            created_by INTEGER
          );

          ALTER TABLE tenant.data ENABLE ROW LEVEL SECURITY;

          CREATE POLICY tenant_isolation ON tenant.data
            FOR ALL
            TO public
            USING (true)
            WITH CHECK (true);
        `,
        description: "create table and policy together",
        expectedSqlTerms: [
          "CREATE TABLE",
          '"tenant"."data"',
          "ALTER TABLE",
          "ENABLE ROW LEVEL SECURITY",
          "CREATE POLICY",
          "tenant_isolation",
          "FOR ALL",
          "TO public",
          "USING",
          "WITH CHECK",
          "true",
        ],
        expectedMasterDependencies: [],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "table:tenant.data",
            referenced_stable_id: "schema:tenant",
            deptype: "n",
          },
          {
            dependent_stable_id: "constraint:tenant.data.data_pkey",
            referenced_stable_id: "table:tenant.data",
            deptype: "a",
          },
          {
            dependent_stable_id: "index:tenant.data_pkey",
            referenced_stable_id: "constraint:tenant.data.data_pkey",
            deptype: "i",
          },
          {
            dependent_stable_id: "policy:tenant.data.tenant_isolation",
            referenced_stable_id: "table:tenant.data",
            deptype: "n",
          },
        ],
      });
    });
  });
}
