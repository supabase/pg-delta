/**
 * Integration tests for PostgreSQL table operations.
 */

import { describe } from "vitest";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { getTest } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTest(pgVersion);

  describe.concurrent(`table operations (pg${pgVersion})`, () => {
    test("simple table with columns", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: `
          CREATE TABLE test_schema.users (
            id integer,
            name text NOT NULL,
            email text
          );
        `,
      });
    });

    test("table with constraints", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: `
          CREATE TABLE test_schema.constrained_table (
            id integer,
            name text NOT NULL,
            email text,
            age integer
          );
        `,
      });
    });

    test("multiple tables", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: `
          CREATE TABLE test_schema.users (
            id integer,
            name text NOT NULL
          );

          CREATE TABLE test_schema.posts (
            id integer,
            title text NOT NULL,
            content text
          );
        `,
      });
    });

    test("table with various types", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: `
          CREATE TABLE test_schema.type_test (
            col_int integer,
            col_bigint bigint,
            col_text text,
            col_varchar varchar(50),
            col_boolean boolean,
            col_timestamp timestamp,
            col_numeric numeric(10,2),
            col_uuid uuid
          );
        `,
      });
    });

    test("table in public schema", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "",
        testSql: `
          CREATE TABLE public.simple_table (
            id integer,
            name text
          );
        `,
      });
    });

    test("empty table", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: `
          CREATE TABLE test_schema.empty_table ();
        `,
      });
    });

    test("tables in multiple schemas", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA schema_a;
          CREATE SCHEMA schema_b;
        `,
        testSql: `
          CREATE TABLE schema_a.table_a (
            id integer,
            name text
          );

          CREATE TABLE schema_b.table_b (
            id integer,
            description text
          );
        `,
      });
    });

    test("partitioned table RANGE", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `CREATE SCHEMA test_schema;`,
        testSql: `
          CREATE TABLE test_schema.events (
            created_at timestamp without time zone NOT NULL,
            payload text
          ) PARTITION BY RANGE (created_at);

          CREATE TABLE test_schema.events_2024 PARTITION OF test_schema.events
          FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');

          CREATE TABLE test_schema.events_2025 PARTITION OF test_schema.events
          FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
        `,
      });
    });

    test("attach partition", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.events (
            created_at timestamp without time zone NOT NULL,
            payload text
          ) PARTITION BY RANGE (created_at);

          CREATE TABLE test_schema.events_2025 (
            created_at timestamp without time zone NOT NULL,
            payload text
          );
        `,
        testSql: `
          ALTER TABLE test_schema.events
          ATTACH PARTITION test_schema.events_2025
          FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
        `,
      });
    });

    test("detach partition", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.events (
            created_at timestamp without time zone NOT NULL,
            payload text
          ) PARTITION BY RANGE (created_at);

          CREATE TABLE test_schema.events_2025 PARTITION OF test_schema.events
          FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
        `,
        testSql: `
          ALTER TABLE test_schema.events
          DETACH PARTITION test_schema.events_2025;
        `,
      });
    });
  });
}
