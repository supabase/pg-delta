import { describe } from "vitest";
import type { Change } from "../../src/core/change.types.ts";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { getTest, getTestIsolated } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTest(pgVersion);
  const testIsolated = getTestIsolated(pgVersion);

  describe.concurrent(`publication operations (pg${pgVersion})`, () => {
    test("create publication with table filters", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA pub_test;
          CREATE TABLE pub_test.accounts (
            id SERIAL PRIMARY KEY,
            status TEXT DEFAULT 'inactive',
            amount INTEGER
          );
        `,
        testSql: `
          CREATE PUBLICATION pub_accounts_filtered
            FOR TABLE pub_test.accounts (id, amount)
            WHERE (status = 'active');
        `,
      });
    });

    test("create publication for tables in schema", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA pub_schema_only;
          CREATE TABLE pub_schema_only.t1 (id SERIAL PRIMARY KEY);
          CREATE TABLE pub_schema_only.t2 (id SERIAL PRIMARY KEY);
        `,
        testSql: `
          CREATE PUBLICATION pub_schema_pub FOR TABLES IN SCHEMA pub_schema_only;
        `,
      });
    });

    test("publication dependency ordering", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA pub_dep;
        `,
        testSql: `
          CREATE SCHEMA pub_dep_extra;
          CREATE TABLE pub_dep.source_table (id SERIAL PRIMARY KEY);
          CREATE TABLE pub_dep_extra.extra_table (id SERIAL PRIMARY KEY);
          CREATE PUBLICATION pub_dep_pub FOR TABLE pub_dep.source_table, TABLES IN SCHEMA pub_dep_extra;
        `,
        sortChangesCallback: (a: Change, b: Change) => {
          // force create publication before its dependent schema and table; dependency graph should fix the order
          const priority = (change: Change) => {
            if (
              change.objectType === "publication" &&
              change.operation === "create"
            ) {
              return 0;
            }
            if (
              change.objectType === "table" &&
              change.operation === "create"
            ) {
              return 1;
            }
            if (
              change.objectType === "schema" &&
              change.operation === "create"
            ) {
              return 1;
            }
            return 2;
          };
          return priority(a) - priority(b);
        },
      });
    });

    test("drop publication", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA pub_test;
          CREATE TABLE pub_test.messages (id SERIAL PRIMARY KEY, body TEXT);
          CREATE PUBLICATION pub_drop_test FOR TABLE pub_test.messages;
        `,
        testSql: `DROP PUBLICATION pub_drop_test;`,
      });
    });

    test("alter publication publish options", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA pub_test;
          CREATE TABLE pub_test.logs (id SERIAL PRIMARY KEY, payload JSONB);
          CREATE PUBLICATION pub_opts FOR TABLE pub_test.logs;
        `,
        testSql: `
          ALTER PUBLICATION pub_opts SET (
            publish = 'insert, update',
            publish_via_partition_root = true
          );
        `,
      });
    });

    test("add and drop publication tables", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA pub_test;
          CREATE TABLE pub_test.users (id SERIAL PRIMARY KEY, active BOOLEAN);
          CREATE TABLE pub_test.sessions (id SERIAL PRIMARY KEY, user_id INTEGER, active BOOLEAN);
          CREATE PUBLICATION pub_tables FOR TABLE pub_test.users;
        `,
        testSql: `
          ALTER PUBLICATION pub_tables ADD TABLE pub_test.sessions WHERE (active IS TRUE);
          ALTER PUBLICATION pub_tables DROP TABLE pub_test.users;
        `,
      });
    });

    test("alter publication schema list", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA pub_a;
          CREATE SCHEMA pub_b;
          CREATE TABLE pub_a.alpha (id INT);
          CREATE TABLE pub_b.beta (id INT);
          CREATE PUBLICATION pub_schemas FOR TABLES IN SCHEMA pub_a;
        `,
        testSql: `
          ALTER PUBLICATION pub_schemas ADD TABLES IN SCHEMA pub_b;
        `,
      });
    });

    test("switch publication from all tables to specific list", async ({
      db,
    }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA pub_test;
          CREATE TABLE pub_test.metrics (id SERIAL PRIMARY KEY, value INTEGER);
          CREATE PUBLICATION pub_all FOR ALL TABLES;
        `,
        testSql: `
          DROP PUBLICATION pub_all;
          CREATE PUBLICATION pub_all FOR TABLE pub_test.metrics;
        `,
      });
    });

    testIsolated("publication owner and comment changes", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE ROLE pub_owner;
          CREATE SCHEMA pub_test;
          CREATE TABLE pub_test.audit (id SERIAL PRIMARY KEY, payload JSONB);
          CREATE PUBLICATION pub_metadata FOR TABLE pub_test.audit;
        `,
        testSql: `
          ALTER PUBLICATION pub_metadata OWNER TO pub_owner;
          COMMENT ON PUBLICATION pub_metadata IS 'audit publication';
        `,
      });
    });
  });
}
