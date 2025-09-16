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
        mainSession: db.main,
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
      });
    });

    test("disable RLS on table", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
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
      });
    });

    // TODO: Fix RLS and policy dependency detection issues
    test("create basic RLS policy", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
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
      });
    });

    test("create policy with WITH CHECK", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
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
      });
    });

    test("create RESTRICTIVE policy", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
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
      });
    });

    test("drop RLS policy", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
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
      });
    });

    test("multiple policies on same table", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
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
      });
    });

    test("complete RLS setup with policies", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
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
      });
    });

    test("create basic RLS policy on simple table", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
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
      });
    });

    test("drop RLS policy from simple table", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
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
      });
    });

    test("policy comments", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA app;
          CREATE TABLE app.docs (
            id integer PRIMARY KEY,
            owner_id integer
          );
          ALTER TABLE app.docs ENABLE ROW LEVEL SECURITY;
          CREATE POLICY owner_only ON app.docs FOR ALL TO public USING (true);
        `,
        testSql: `
          COMMENT ON POLICY owner_only ON app.docs IS 'only owners have access';
        `,
      });
    });
  });
}
