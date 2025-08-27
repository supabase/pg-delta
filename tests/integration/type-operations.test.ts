/**
 * Integration tests for PostgreSQL type operations.
 */

import { describe } from "vitest";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { getTest } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTest(pgVersion);

  describe.concurrent(`type operations (pg${pgVersion})`, () => {
    test("create enum type", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.a,
        branchSession: db.b,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: `
          CREATE TYPE test_schema.mood AS ENUM ('sad', 'ok', 'happy');
        `,
        description: "create enum type",
        expectedSqlTerms: [
          `CREATE TYPE test_schema.mood AS ENUM ('sad', 'ok', 'happy')`,
        ],
      });
    });
    test("create domain type with constraint", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.a,
        branchSession: db.b,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: `
          CREATE DOMAIN test_schema.positive_int AS INTEGER CHECK (VALUE > 0);
        `,
        description: "create domain type with constraint",
        expectedSqlTerms: [
          `CREATE DOMAIN test_schema.positive_int AS integer CHECK ((VALUE > 0))`,
        ],
      });
    });
    test("create composite type", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.a,
        branchSession: db.b,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: `
          CREATE TYPE test_schema.address AS (
            street VARCHAR(90),
            city VARCHAR(90),
            state VARCHAR(2)
          );
        `,
        description: "create composite type",
        expectedSqlTerms: [
          `CREATE TYPE test_schema.address AS (street character varying(90), city character varying(90), state character varying(2))`,
        ],
      });
    });
    test("create range type", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.a,
        branchSession: db.b,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: `
          CREATE TYPE test_schema.floatrange AS RANGE (subtype = float8);
        `,
        description: "create range type",
        expectedSqlTerms: [
          `CREATE TYPE test_schema.floatrange AS RANGE (subtype = double precision)`,
        ],
      });
    });
    test("drop enum type", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.a,
        branchSession: db.b,
        initialSetup:
          "CREATE SCHEMA test_schema; CREATE TYPE test_schema.old_mood AS ENUM ('sad', 'happy');",
        testSql: `
          DROP TYPE test_schema.old_mood;
        `,
        description: "drop enum type",
        expectedSqlTerms: [`DROP TYPE test_schema.old_mood`],
      });
    });
    test("replace enum type (modify values)", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.a,
        branchSession: db.b,
        initialSetup:
          "CREATE SCHEMA test_schema; CREATE TYPE test_schema.status AS ENUM ('pending', 'approved');",
        testSql: `
          DROP TYPE test_schema.status;
          CREATE TYPE test_schema.status AS ENUM ('pending', 'approved', 'rejected');
        `,
        description: "replace enum type (modify values)",
        expectedSqlTerms: [
          `ALTER TYPE test_schema.status ADD VALUE 'rejected' AFTER 'approved'`,
        ],
      });
    });
    test("replace domain type (modify constraint)", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.a,
        branchSession: db.b,
        initialSetup:
          "CREATE SCHEMA test_schema; CREATE DOMAIN test_schema.valid_int AS INTEGER CHECK (VALUE > 0);",
        testSql: `
          DROP DOMAIN test_schema.valid_int;
          CREATE DOMAIN test_schema.valid_int AS INTEGER CHECK (VALUE >= 0 AND VALUE <= 100);
        `,
        description: "replace domain type (modify constraint)",
        expectedSqlTerms: [
          `ALTER DOMAIN test_schema.valid_int DROP CONSTRAINT valid_int_check`,
          `ALTER DOMAIN test_schema.valid_int ADD CONSTRAINT valid_int_check CHECK (((VALUE >= 0) AND (VALUE <= 100)))`,
        ],
      });
    });
  });
  test.only("enum type with table dependency", async ({ db }) => {
    await roundtripFidelityTest({
      name: "enum-table-dependency",
      masterSession: db.a,
      branchSession: db.b,
      initialSetup: "CREATE SCHEMA test_schema;",
      testSql: `
      CREATE TYPE test_schema.user_status AS ENUM ('active', 'inactive', 'pending');

      CREATE TABLE test_schema.users (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        status test_schema.user_status DEFAULT 'pending'
      );
    `,
      description: "enum type with table dependency",
      expectedSqlTerms: [
        `CREATE TYPE test_schema.user_status AS ENUM ('active', 'inactive', 'pending')`,
        `CREATE TABLE test_schema.users (id integer NOT NULL, name text NOT NULL, status test_schema.user_status DEFAULT 'pending'::test_schema.user_status)`,
        `CREATE UNIQUE INDEX users_pkey ON test_schema.users (id COLLATE \"default\" pg_catalog.int4_ops)`,
      ],
      expectedMasterDependencies: [],
      expectedBranchDependencies: [
        {
          dependent_stable_id: "enum:test_schema.user_status",
          referenced_stable_id: "schema:test_schema",
          deptype: "n",
        }, // Enum type depend on schema
        {
          dependent_stable_id: "table:test_schema.users",
          referenced_stable_id: "schema:test_schema",
          deptype: "n",
        }, // Table depends on schema
        {
          dependent_stable_id: "table:test_schema.users",
          referenced_stable_id: "enum:test_schema.user_status",
          deptype: "n",
        }, // Table depends on enum type
        {
          dependent_stable_id: "index:test_schema.users_pkey",
          referenced_stable_id: "constraint:test_schema.users.users_pkey",
          deptype: "i",
        }, // Index depends on constraint
        {
          dependent_stable_id: "constraint:test_schema.users.users_pkey",
          referenced_stable_id: "table:test_schema.users",
          deptype: "a",
        }, // Constraint depends on table
      ],
    });
  });
}
