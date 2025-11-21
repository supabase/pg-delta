/**
 * Integration tests for PostgreSQL sequence operations.
 */

import { describe } from "vitest";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { getTest } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTest(pgVersion);

  describe.concurrent(`sequence operations (pg${pgVersion})`, () => {
    test("create basic sequence", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: "CREATE SEQUENCE test_schema.test_seq;",
      });
    });

    test("create sequence with options", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: `
          CREATE SEQUENCE test_schema.custom_seq
            AS integer
            INCREMENT BY 2
            MINVALUE 10
            MAXVALUE 1000
            START WITH 10
            CACHE 5
            CYCLE;
        `,
      });
    });

    test("drop sequence", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE SEQUENCE test_schema.test_seq;
        `,
        testSql: "DROP SEQUENCE test_schema.test_seq;",
      });
    });

    test("create table with serial column (sequence dependency)", async ({
      db,
    }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: `
          CREATE TABLE test_schema.users (
            id SERIAL PRIMARY KEY,
            name TEXT
          );
        `,
      });
    });

    test("alter sequence properties", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE SEQUENCE test_schema.test_seq INCREMENT BY 1 CACHE 1;
        `,
        testSql: `
          ALTER SEQUENCE test_schema.test_seq INCREMENT BY 5 CACHE 10;
        `,
      });
    });

    test("sequence comments", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE SEQUENCE test_schema.seq1;
        `,
        testSql: `
          COMMENT ON SEQUENCE test_schema.seq1 IS 'test sequence comment';
        `,
      });
    });

    test("sequence owned by table column cycle (reproduces acceptsDependency issue)", async ({
      db,
    }) => {
      // This test reproduces a potential cycle that occurs when:
      // 1. CREATE SEQUENCE is created first (without OWNED BY)
      // 2. CREATE TABLE uses the sequence in a default (nextval)
      // 3. ALTER SEQUENCE OWNED BY references the table column
      //
      // Potential cycle without filtering:
      // - CREATE TABLE depends on CREATE SEQUENCE (via pg_depend: column default depends on sequence)
      // - ALTER SEQUENCE OWNED BY depends on CREATE TABLE (via explicit requires: needs the column)
      // - If pg_depend also says sequence depends on table (ownership), we'd have:
      //   CREATE SEQUENCE → CREATE TABLE → CREATE SEQUENCE (cycle!)
      //
      // The graph-level filter breaks this cycle by filtering out ownership dependencies
      // FROM the sequence TO the table/column it's owned by.
      //
      // Expected order:
      // 1. CREATE SEQUENCE (no dependencies)
      // 2. CREATE TABLE (depends on sequence)
      // 3. ALTER SEQUENCE OWNED BY (depends on table/column)
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: `
          CREATE SEQUENCE test_schema.user_id_seq;

          CREATE TABLE test_schema.users (
            id bigint PRIMARY KEY DEFAULT nextval('test_schema.user_id_seq')
          );

          ALTER SEQUENCE test_schema.user_id_seq OWNED BY test_schema.users.id;
        `,
        // Validate the expected order: sequence → table → alter sequence → constraint
        // Note: PRIMARY KEY constraint is added as a separate ALTER TABLE statement
        expectedSqlTerms: [
          "CREATE SEQUENCE test_schema.user_id_seq",
          "CREATE TABLE test_schema.users (id bigint DEFAULT nextval('test_schema.user_id_seq'::regclass) NOT NULL)",
          "ALTER SEQUENCE test_schema.user_id_seq OWNED BY test_schema.users.id",
          "ALTER TABLE test_schema.users ADD CONSTRAINT users_pkey PRIMARY KEY (id)",
        ],
      });
    });

    test("drop table with owned sequence (skips DROP SEQUENCE)", async ({
      db,
    }) => {
      // This test verifies that the diff tool correctly skips generating DROP SEQUENCE
      // when a sequence is owned by a table that's being dropped.
      //
      // Scenario:
      // 1. Sequence is owned by a table column
      // 2. Table uses the sequence in a default (nextval)
      // 3. Table is dropped
      //
      // When PostgreSQL drops a table that owns a sequence, it automatically drops
      // the sequence as well. The diff tool should detect this and skip generating
      // DROP SEQUENCE to avoid migration errors (sequence doesn't exist).
      //
      // Expected: Only DROP TABLE is generated (no DROP SEQUENCE)
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE SEQUENCE test_schema.user_id_seq;
          CREATE TABLE test_schema.users (
            id bigint PRIMARY KEY DEFAULT nextval('test_schema.user_id_seq')
          );
          ALTER SEQUENCE test_schema.user_id_seq OWNED BY test_schema.users.id;
        `,
        testSql: `
          DROP TABLE test_schema.users;
        `,
        // Validate that only DROP TABLE is generated
        // The sequence is owned by the table, so PostgreSQL auto-drops it when the table is dropped.
        // The diff tool correctly skips generating DROP SEQUENCE to avoid errors.
        expectedSqlTerms: ["DROP TABLE test_schema.users"],
      });
    });
  });
}
