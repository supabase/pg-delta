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
  });
}
