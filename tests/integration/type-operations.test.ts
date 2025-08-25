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
    test("create schema and composite type", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.a,
        branchSession: db.b,
        initialSetup: "",
        testSql: `
          CREATE SCHEMA test_schema;
          CREATE TYPE test_schema.address AS (
            street VARCHAR(90),
            city VARCHAR(90),
            state VARCHAR(2)
          );
        `,
        description: "create composite type",
        expectedSqlTerms: [
          `CREATE SCHEMA test_schema AUTHORIZATION supabase_admin`,
          `CREATE TYPE test_schema.address AS (street character varying(90), city character varying(90), state character varying(2))`,
        ],
      });
    });
  });
}
