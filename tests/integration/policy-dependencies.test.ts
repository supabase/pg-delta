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
          "ALTER TABLE security.users ENABLE ROW LEVEL SECURITY",
          "CREATE POLICY user_isolation ON security.users USING (true)",
        ],
        expectedMasterDependencies: [
          {
            dependent_stable_id: "table:security.users",
            referenced_stable_id: "schema:security",
            deptype: "n",
          }, // Table depends on schema
          {
            dependent_stable_id: "constraint:security.users.users_pkey",
            referenced_stable_id: "table:security.users",
            deptype: "a",
          }, // Primary key depends on table
          {
            dependent_stable_id: "index:security.users_pkey",
            referenced_stable_id: "constraint:security.users.users_pkey",
            deptype: "i",
          }, // Index depends on constraint
          {
            dependent_stable_id: "constraint:security.users.users_email_key",
            referenced_stable_id: "table:security.users",
            deptype: "a",
          }, // Unique constraint depends on table
          {
            dependent_stable_id: "index:security.users_email_key",
            referenced_stable_id: "constraint:security.users.users_email_key",
            deptype: "i",
          }, // Unique index depends on constraint
        ],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "table:security.users",
            referenced_stable_id: "schema:security",
            deptype: "n",
          }, // Table depends on schema
          {
            dependent_stable_id: "constraint:security.users.users_pkey",
            referenced_stable_id: "table:security.users",
            deptype: "a",
          }, // Primary key depends on table
          {
            dependent_stable_id: "index:security.users_pkey",
            referenced_stable_id: "constraint:security.users.users_pkey",
            deptype: "i",
          }, // Index depends on constraint
          {
            dependent_stable_id: "constraint:security.users.users_email_key",
            referenced_stable_id: "table:security.users",
            deptype: "a",
          }, // Unique constraint depends on table
          {
            dependent_stable_id: "index:security.users_email_key",
            referenced_stable_id: "constraint:security.users.users_email_key",
            deptype: "i",
          }, // Unique index depends on constraint
          {
            dependent_stable_id: "rlsPolicy:security.users.user_isolation",
            referenced_stable_id: "table:security.users",
            deptype: "a",
          }, // Policy depends on table
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
          "ALTER TABLE app.posts ENABLE ROW LEVEL SECURITY",
          "CREATE POLICY update_own_posts ON app.posts FOR UPDATE USING (true) WITH CHECK (true)",
          "CREATE POLICY read_posts ON app.posts FOR SELECT USING ((published = true))",
          "CREATE POLICY insert_own_posts ON app.posts FOR INSERT WITH CHECK (true)",
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
            dependent_stable_id: "rlsPolicy:app.posts.read_posts",
            referenced_stable_id: "table:app.posts",
            deptype: "a",
          },
          {
            dependent_stable_id: "rlsPolicy:app.posts.insert_own_posts",
            referenced_stable_id: "table:app.posts",
            deptype: "a",
          },
          {
            dependent_stable_id: "rlsPolicy:app.posts.update_own_posts",
            referenced_stable_id: "table:app.posts",
            deptype: "a",
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
          "CREATE TABLE tenant.data (id integer NOT NULL, tenant_id integer NOT NULL, content text NOT NULL, created_by integer)",
          "ALTER TABLE tenant.data ADD CONSTRAINT data_pkey PRIMARY KEY (id)",
          "CREATE POLICY tenant_isolation ON tenant.data USING (true) WITH CHECK (true)",
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
        ],
      });
    });
  });
}
