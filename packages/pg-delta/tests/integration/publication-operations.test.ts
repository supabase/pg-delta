import { describe, expect, test } from "bun:test";
import type { Change } from "../../src/core/change.types.ts";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { withDb, withDbIsolated } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`publication operations (pg${pgVersion})`, () => {
    // Column lists + row filters are PG15+ (pg_publication_rel.prattrs/prqual).
    test.skipIf(pgVersion < 15)(
      "create publication with table filters",
      withDb(pgVersion, async (db) => {
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
      }),
    );

    // FOR TABLES IN SCHEMA is PG15+ (pg_publication_namespace).
    test.skipIf(pgVersion < 15)(
      "create publication for tables in schema",
      withDb(pgVersion, async (db) => {
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
      }),
    );

    // Uses FOR TABLES IN SCHEMA, PG15+.
    test.skipIf(pgVersion < 15)(
      "publication dependency ordering",
      withDb(pgVersion, async (db) => {
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
      }),
    );

    test(
      "drop publication",
      withDb(pgVersion, async (db) => {
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
      }),
    );

    test(
      "alter publication publish options",
      withDb(pgVersion, async (db) => {
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
      }),
    );

    // ADD TABLE ... WHERE (row filter) is PG15+.
    test.skipIf(pgVersion < 15)(
      "add and drop publication tables",
      withDb(pgVersion, async (db) => {
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
      }),
    );

    // ADD TABLES IN SCHEMA is PG15+.
    test.skipIf(pgVersion < 15)(
      "alter publication schema list",
      withDb(pgVersion, async (db) => {
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
      }),
    );

    test(
      "switch publication from all tables to specific list",
      withDb(pgVersion, async (db) => {
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
      }),
    );

    test(
      "publication owner and comment changes",
      withDbIsolated(pgVersion, async (db) => {
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
      }),
    );

    test(
      "drop table from publication before dropping table",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE TABLE public.challenge_levels (
            id BIGINT PRIMARY KEY
          );

          CREATE PUBLICATION pub_drop_order FOR TABLE public.challenge_levels;
        `,
          testSql: `
          ALTER PUBLICATION pub_drop_order DROP TABLE public.challenge_levels;
          DROP TABLE public.challenge_levels;
        `,
          assertSqlStatements: (statements) => {
            const relevantStatements = statements.filter(
              (statement) =>
                statement ===
                  "ALTER PUBLICATION pub_drop_order DROP TABLE public.challenge_levels" ||
                statement === "DROP TABLE public.challenge_levels",
            );

            expect(relevantStatements).toMatchInlineSnapshot(`
              [
                "ALTER PUBLICATION pub_drop_order DROP TABLE public.challenge_levels",
                "DROP TABLE public.challenge_levels",
              ]
            `);
          },
        });
      }),
    );
  });
}
