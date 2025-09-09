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
  describe.concurrent(`RLS operations (pg${pgVersion})`, () => {
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

    // TODO: Fix RLS and policy dependency detection issues
    test("create basic RLS policy", async ({ db }) => {
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
          CREATE POLICY user_isolation ON app.users
            FOR ALL
            TO public
            USING (true);
        `,
        description: "create basic RLS policy",
        expectedSqlTerms: [
          "CREATE POLICY user_isolation ON app.users USING (true)",
        ],
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
          {
            dependent_stable_id: "rlsPolicy:app.users.user_isolation",
            referenced_stable_id: "table:app.users",
            deptype: "a",
          },
        ],
      });
    });

    test("create policy with WITH CHECK", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA blog;
          CREATE TABLE blog.posts (
            id INTEGER PRIMARY KEY,
            title TEXT NOT NULL,
            content TEXT,
            author_id INTEGER NOT NULL,
            published BOOLEAN DEFAULT false
          );
          ALTER TABLE blog.posts ENABLE ROW LEVEL SECURITY;
        `,
        testSql: `
          CREATE POLICY insert_own_posts ON blog.posts
            FOR INSERT
            TO public
            WITH CHECK (true);
        `,
        description: "create policy with WITH CHECK",
        expectedSqlTerms: [
          "CREATE POLICY insert_own_posts ON blog.posts FOR INSERT WITH CHECK (true)",

        ],
        expectedMasterDependencies: [
          {
            dependent_stable_id: "table:blog.posts",
            referenced_stable_id: "schema:blog",
            deptype: "n",
          },
          {
            dependent_stable_id: "constraint:blog.posts.posts_pkey",
            referenced_stable_id: "table:blog.posts",
            deptype: "a",
          },
          {
            dependent_stable_id: "index:blog.posts_pkey",
            referenced_stable_id: "constraint:blog.posts.posts_pkey",
            deptype: "i",
          },
        ],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "table:blog.posts",
            referenced_stable_id: "schema:blog",
            deptype: "n",
          },
          {
            dependent_stable_id: "constraint:blog.posts.posts_pkey",
            referenced_stable_id: "table:blog.posts",
            deptype: "a",
          },
          {
            dependent_stable_id: "index:blog.posts_pkey",
            referenced_stable_id: "constraint:blog.posts.posts_pkey",
            deptype: "i",
          },
          {
            dependent_stable_id: "rlsPolicy:blog.posts.insert_own_posts",
            referenced_stable_id: "table:blog.posts",
            deptype: "a",
          },
        ],
      });
    });

    test("create RESTRICTIVE policy", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA secure;
          CREATE TABLE secure.sensitive_data (
            id INTEGER PRIMARY KEY,
            data TEXT NOT NULL,
            classification TEXT NOT NULL
          );
          ALTER TABLE secure.sensitive_data ENABLE ROW LEVEL SECURITY;
        `,
        testSql: `
          CREATE POLICY admin_only ON secure.sensitive_data
            AS RESTRICTIVE
            FOR SELECT
            TO public
            USING (true);
        `,
        description: "create RESTRICTIVE policy",
        expectedSqlTerms: [
          "CREATE POLICY admin_only ON secure.sensitive_data AS RESTRICTIVE FOR SELECT USING (true)",

        ],
        expectedMasterDependencies: [
          {
            dependent_stable_id: "table:secure.sensitive_data",
            referenced_stable_id: "schema:secure",
            deptype: "n",
          },
          {
            dependent_stable_id:
              "constraint:secure.sensitive_data.sensitive_data_pkey",
            referenced_stable_id: "table:secure.sensitive_data",
            deptype: "a",
          },
          {
            dependent_stable_id: "index:secure.sensitive_data_pkey",
            referenced_stable_id:
              "constraint:secure.sensitive_data.sensitive_data_pkey",
            deptype: "i",
          },
        ],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "table:secure.sensitive_data",
            referenced_stable_id: "schema:secure",
            deptype: "n",
          },
          {
            dependent_stable_id:
              "constraint:secure.sensitive_data.sensitive_data_pkey",
            referenced_stable_id: "table:secure.sensitive_data",
            deptype: "a",
          },
          {
            dependent_stable_id: "index:secure.sensitive_data_pkey",
            referenced_stable_id:
              "constraint:secure.sensitive_data.sensitive_data_pkey",
            deptype: "i",
          },
          {
            dependent_stable_id: "rlsPolicy:secure.sensitive_data.admin_only",
            referenced_stable_id: "table:secure.sensitive_data",
            deptype: "a",
          },
        ],
      });
    });

    test("drop RLS policy", async ({ db }) => {
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
          CREATE POLICY user_isolation ON app.users
            FOR ALL
            TO public
            USING (true);
        `,
        testSql: `
          DROP POLICY user_isolation ON app.users;
        `,
        description: "drop RLS policy",
        expectedSqlTerms: [  "DROP POLICY user_isolation ON app.users",
        ],
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
          {
            dependent_stable_id: "rlsPolicy:app.users.user_isolation",
            referenced_stable_id: "table:app.users",
            deptype: "a",
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

    test("multiple policies on same table", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA forum;
          CREATE TABLE forum.messages (
            id INTEGER PRIMARY KEY,
            content TEXT NOT NULL,
            author_id INTEGER NOT NULL,
            thread_id INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
          ALTER TABLE forum.messages ENABLE ROW LEVEL SECURITY;
        `,
        testSql: `
          -- Read rlsPolicy: users can read all messages
          CREATE POLICY read_messages ON forum.messages
            FOR SELECT
            TO public
            USING (true);

          -- Insert rlsPolicy: users can only insert their own messages
          CREATE POLICY insert_own_messages ON forum.messages
            FOR INSERT
            TO public
            WITH CHECK (true);

          -- Update rlsPolicy: users can only update their own messages
          CREATE POLICY update_own_messages ON forum.messages
            FOR UPDATE
            TO public
            USING (true)
            WITH CHECK (true);
        `,
        description: "multiple policies on same table",
        expectedSqlTerms: [
          "CREATE POLICY update_own_messages ON forum.messages FOR UPDATE USING (true) WITH CHECK (true)",
          "CREATE POLICY read_messages ON forum.messages FOR SELECT USING (true)",
          "CREATE POLICY insert_own_messages ON forum.messages FOR INSERT WITH CHECK (true)",
        ],
        expectedMasterDependencies: [
          {
            dependent_stable_id: "table:forum.messages",
            referenced_stable_id: "schema:forum",
            deptype: "n",
          },
          {
            dependent_stable_id: "constraint:forum.messages.messages_pkey",
            referenced_stable_id: "table:forum.messages",
            deptype: "a",
          },
          {
            dependent_stable_id: "index:forum.messages_pkey",
            referenced_stable_id: "constraint:forum.messages.messages_pkey",
            deptype: "i",
          },
        ],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "table:forum.messages",
            referenced_stable_id: "schema:forum",
            deptype: "n",
          },
          {
            dependent_stable_id: "constraint:forum.messages.messages_pkey",
            referenced_stable_id: "table:forum.messages",
            deptype: "a",
          },
          {
            dependent_stable_id: "index:forum.messages_pkey",
            referenced_stable_id: "constraint:forum.messages.messages_pkey",
            deptype: "i",
          },
          {
            dependent_stable_id: "rlsPolicy:forum.messages.read_messages",
            referenced_stable_id: "table:forum.messages",
            deptype: "a",
          },
          {
            dependent_stable_id: "rlsPolicy:forum.messages.insert_own_messages",
            referenced_stable_id: "table:forum.messages",
            deptype: "a",
          },
          {
            dependent_stable_id: "rlsPolicy:forum.messages.update_own_messages",
            referenced_stable_id: "table:forum.messages",
            deptype: "a",
          },
        ],
      });
    });

    test("complete RLS setup with policies", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA tenant;
        `,
        testSql: `
          -- Create a multi-tenant table
          CREATE TABLE tenant.data (
            id INTEGER PRIMARY KEY,
            tenant_id INTEGER NOT NULL,
            content TEXT NOT NULL,
            created_by INTEGER NOT NULL
          );

          -- Enable RLS
          ALTER TABLE tenant.data ENABLE ROW LEVEL SECURITY;

          -- Create tenant isolation policy
          CREATE POLICY tenant_isolation ON tenant.data
            FOR ALL
            TO public
            USING (true)
            WITH CHECK (true);

          -- Create admin bypass policy (PERMISSIVE - default)
          CREATE POLICY admin_bypass ON tenant.data
            FOR ALL
            TO public
            USING (true)
            WITH CHECK (true);
        `,
        description: "complete RLS setup with policies",
        expectedSqlTerms: [
          "CREATE TABLE tenant.data (id integer NOT NULL, tenant_id integer NOT NULL, content text NOT NULL, created_by integer NOT NULL)",
          "ALTER TABLE tenant.data ADD CONSTRAINT data_pkey PRIMARY KEY (id)",
          "CREATE POLICY tenant_isolation ON tenant.data USING (true) WITH CHECK (true)",
          "CREATE POLICY admin_bypass ON tenant.data USING (true) WITH CHECK (true)",
        
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
            dependent_stable_id: "rlsPolicy:tenant.data.tenant_isolation",
            referenced_stable_id: "table:tenant.data",
            deptype: "a",
          },
          {
            dependent_stable_id: "rlsPolicy:tenant.data.admin_bypass",
            referenced_stable_id: "table:tenant.data",
            deptype: "a",
          },
        ],
      });
    });

    test("create basic RLS policy on simple table", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA app;
          CREATE TABLE app.users (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL
          );
          ALTER TABLE app.users ENABLE ROW LEVEL SECURITY;
        `,
        testSql: `
          CREATE POLICY user_policy ON app.users
            FOR ALL
            TO public
            USING (true);
        `,
        description: "create basic RLS policy on simple table",
        expectedSqlTerms: [
          "CREATE POLICY user_policy ON app.users USING (true)",

        ],
        expectedMasterDependencies: [
          {
            dependent_stable_id: "table:app.users",
            referenced_stable_id: "schema:app",
            deptype: "n",
          },
          {
            dependent_stable_id: "constraint:app.users.users_pkey",
            referenced_stable_id: "table:app.users",
            deptype: "a",
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
            dependent_stable_id: "constraint:app.users.users_pkey",
            referenced_stable_id: "table:app.users",
            deptype: "a",
          },
          {
            dependent_stable_id: "index:app.users_pkey",
            referenced_stable_id: "constraint:app.users.users_pkey",
            deptype: "i",
          },
          {
            dependent_stable_id: "rlsPolicy:app.users.user_policy",
            referenced_stable_id: "table:app.users",
            deptype: "a",
          },
        ],
      });
    });

    test("drop RLS policy from simple table", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA app;
          CREATE TABLE app.users (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL
          );
          ALTER TABLE app.users ENABLE ROW LEVEL SECURITY;
          CREATE POLICY user_policy ON app.users
            FOR ALL
            TO public
            USING (true);
        `,
        testSql: `
          DROP POLICY user_policy ON app.users;
        `,
        description: "drop RLS policy from simple table",
        expectedSqlTerms: [
          "DROP POLICY user_policy ON app.users",
        ],
        expectedMasterDependencies: [
          {
            dependent_stable_id: "table:app.users",
            referenced_stable_id: "schema:app",
            deptype: "n",
          },
          {
            dependent_stable_id: "constraint:app.users.users_pkey",
            referenced_stable_id: "table:app.users",
            deptype: "a",
          },
          {
            dependent_stable_id: "index:app.users_pkey",
            referenced_stable_id: "constraint:app.users.users_pkey",
            deptype: "i",
          },
          {
            dependent_stable_id: "rlsPolicy:app.users.user_policy",
            referenced_stable_id: "table:app.users",
            deptype: "a",
          },
        ],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "table:app.users",
            referenced_stable_id: "schema:app",
            deptype: "n",
          },
          {
            dependent_stable_id: "constraint:app.users.users_pkey",
            referenced_stable_id: "table:app.users",
            deptype: "a",
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
