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
        mainSession: db.main,
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
      });
    });

    test("multiple policies with dependencies", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
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
      });
    });

    test("create table and policy together", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
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
      });
    });
  });
}
