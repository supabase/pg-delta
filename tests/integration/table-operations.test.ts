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
    // test("simple table with columns", async ({ db }) => {
    //   await roundtripFidelityTest({
    //     mainSession: db.main,
    //     branchSession: db.branch,
    //     initialSetup: "CREATE SCHEMA test_schema;",
    //     testSql: `
    //       CREATE TABLE test_schema.users (
    //         id integer,
    //         name text NOT NULL,
    //         email text
    //       );
    //     `,
    //     description: "simple table with columns",
    //     expectedSqlTerms: [
    //       `CREATE TABLE test_schema.users (id integer, name text NOT NULL, email text)`,
    //     ],
    //     expectedMainDependencies: [],
    //     expectedBranchDependencies: [
    //       {
    //         dependent_stable_id: "table:test_schema.users",
    //         referenced_stable_id: "schema:test_schema",
    //         deptype: "n",
    //       },
    //     ],
    //   });
    // });

    // test("table with constraints", async ({ db }) => {
    //   await roundtripFidelityTest({
    //     mainSession: db.main,
    //     branchSession: db.branch,
    //     initialSetup: "CREATE SCHEMA test_schema;",
    //     testSql: `
    //       CREATE TABLE test_schema.constrained_table (
    //         id integer,
    //         name text NOT NULL,
    //         email text,
    //         age integer
    //       );
    //     `,
    //     description: "table with constraints",
    //     expectedSqlTerms: [
    //       `CREATE TABLE test_schema.constrained_table (id integer, name text NOT NULL, email text, age integer)`,
    //     ],
    //     expectedMainDependencies: [],
    //     expectedBranchDependencies: [
    //       {
    //         dependent_stable_id: "table:test_schema.constrained_table",
    //         referenced_stable_id: "schema:test_schema",
    //         deptype: "n",
    //       },
    //     ],
    //   });
    // });

    // test("multiple tables", async ({ db }) => {
    //   await roundtripFidelityTest({
    //     mainSession: db.main,
    //     branchSession: db.branch,
    //     initialSetup: "CREATE SCHEMA test_schema;",
    //     testSql: `
    //       CREATE TABLE test_schema.users (
    //         id integer,
    //         name text NOT NULL
    //       );

    //       CREATE TABLE test_schema.posts (
    //         id integer,
    //         title text NOT NULL,
    //         content text
    //       );
    //     `,
    //     description: "multiple tables",
    //     expectedSqlTerms: [
    //       `CREATE TABLE test_schema.users (id integer, name text NOT NULL)`,
    //       `CREATE TABLE test_schema.posts (id integer, title text NOT NULL, content text)`,
    //     ],
    //     expectedMainDependencies: [],
    //     expectedBranchDependencies: [
    //       {
    //         dependent_stable_id: "table:test_schema.users",
    //         referenced_stable_id: "schema:test_schema",
    //         deptype: "n",
    //       },
    //       {
    //         dependent_stable_id: "table:test_schema.posts",
    //         referenced_stable_id: "schema:test_schema",
    //         deptype: "n",
    //       },
    //     ],
    //   });
    // });

    // test("table with various types", async ({ db }) => {
    //   await roundtripFidelityTest({
    //     mainSession: db.main,
    //     branchSession: db.branch,
    //     initialSetup: "CREATE SCHEMA test_schema;",
    //     testSql: `
    //       CREATE TABLE test_schema.type_test (
    //         col_int integer,
    //         col_bigint bigint,
    //         col_text text,
    //         col_varchar varchar(50),
    //         col_boolean boolean,
    //         col_timestamp timestamp,
    //         col_numeric numeric(10,2),
    //         col_uuid uuid
    //       );
    //     `,
    //     description: "table with various types",
    //     expectedSqlTerms: [
    //       `CREATE TABLE test_schema.type_test (col_int integer, col_bigint bigint, col_text text, col_varchar character varying(50), col_boolean boolean, col_timestamp timestamp without time zone, col_numeric numeric(10,2), col_uuid uuid)`,
    //     ],
    //     expectedMainDependencies: [],
    //     expectedBranchDependencies: [
    //       {
    //         dependent_stable_id: "table:test_schema.type_test",
    //         referenced_stable_id: "schema:test_schema",
    //         deptype: "n",
    //       },
    //     ],
    //   });
    // });

    // test("table in public schema", async ({ db }) => {
    //   await roundtripFidelityTest({
    //     mainSession: db.main,
    //     branchSession: db.branch,
    //     initialSetup: "",
    //     testSql: `
    //       CREATE TABLE public.simple_table (
    //         id integer,
    //         name text
    //       );
    //     `,
    //     description: "table in public schema",
    //     expectedSqlTerms: [
    //       `CREATE TABLE public.simple_table (id integer, name text)`,
    //     ],
    //     expectedMainDependencies: [],
    //     expectedBranchDependencies: [
    //       {
    //         dependent_stable_id: "table:public.simple_table",
    //         referenced_stable_id: "schema:public",
    //         deptype: "n",
    //       },
    //     ],
    //   });
    // });

    // test("empty table", async ({ db }) => {
    //   await roundtripFidelityTest({
    //     mainSession: db.main,
    //     branchSession: db.branch,
    //     initialSetup: "CREATE SCHEMA test_schema;",
    //     testSql: `
    //       CREATE TABLE test_schema.empty_table ();
    //     `,
    //     description: "empty table",
    //     expectedSqlTerms: [`CREATE TABLE test_schema.empty_table ()`],
    //     expectedMainDependencies: [],
    //     expectedBranchDependencies: [
    //       {
    //         dependent_stable_id: "table:test_schema.empty_table",
    //         referenced_stable_id: "schema:test_schema",
    //         deptype: "n",
    //       },
    //     ],
    //   });
    // });

    // test("tables in multiple schemas", async ({ db }) => {
    //   await roundtripFidelityTest({
    //     mainSession: db.main,
    //     branchSession: db.branch,
    //     initialSetup: `
    //       CREATE SCHEMA schema_a;
    //       CREATE SCHEMA schema_b;
    //     `,
    //     testSql: `
    //       CREATE TABLE schema_a.table_a (
    //         id integer,
    //         name text
    //       );

    //       CREATE TABLE schema_b.table_b (
    //         id integer,
    //         description text
    //       );
    //     `,
    //     description: "tables in multiple schemas",
    //     expectedSqlTerms: [
    //       `CREATE TABLE schema_b.table_b (id integer, description text)`,
    //       `CREATE TABLE schema_a.table_a (id integer, name text)`,
    //     ],
    //     expectedMainDependencies: [],
    //     expectedBranchDependencies: [
    //       {
    //         dependent_stable_id: "table:schema_a.table_a",
    //         referenced_stable_id: "schema:schema_a",
    //         deptype: "n",
    //       },
    //       {
    //         dependent_stable_id: "table:schema_b.table_b",
    //         referenced_stable_id: "schema:schema_b",
    //         deptype: "n",
    //       },
    //     ],
    //   });
    // });

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
        description: "partitioned table by RANGE",
        expectedSqlTerms: [
          `CREATE TABLE test_schema.events (created_at timestamp without time zone NOT NULL, payload text) PARTITION BY RANGE (created_at)`,
          // TODO: sort PARTITION OF statements alphabetically
          `CREATE TABLE test_schema.events_2025 PARTITION OF test_schema.events FOR VALUES FROM ('2025-01-01 00:00:00') TO ('2026-01-01 00:00:00')`,
          `CREATE TABLE test_schema.events_2024 PARTITION OF test_schema.events FOR VALUES FROM ('2024-01-01 00:00:00') TO ('2025-01-01 00:00:00')`,
        ],
        expectedMainDependencies: [],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "table:test_schema.events",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "table:test_schema.events_2024",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "table:test_schema.events_2024",
            referenced_stable_id: "table:test_schema.events",
            deptype: "a",
          },
          {
            dependent_stable_id: "table:test_schema.events_2025",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "table:test_schema.events_2025",
            referenced_stable_id: "table:test_schema.events",
            deptype: "a",
          },
        ],
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
        description: "attach an existing table as partition",
        expectedSqlTerms: [
          `ALTER TABLE test_schema.events ATTACH PARTITION test_schema.events_2025 FOR VALUES FROM ('2025-01-01 00:00:00') TO ('2026-01-01 00:00:00')`,
        ],
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
        description: "detach an existing partition",
        expectedSqlTerms: [
          `ALTER TABLE test_schema.events DETACH PARTITION test_schema.events_2025`,
        ],
      });
    });
  });
}
