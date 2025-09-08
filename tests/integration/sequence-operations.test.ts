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
        masterSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: "CREATE SEQUENCE test_schema.test_seq;",
        description: "create basic sequence",
        expectedSqlTerms: [`CREATE SEQUENCE test_schema.test_seq`],
        expectedMasterDependencies: [],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "sequence:test_schema.test_seq",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
      });
    });

    test("create sequence with options", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.main,
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
        description: "create sequence with options",
        expectedSqlTerms: [
          `CREATE SEQUENCE test_schema.custom_seq AS integer INCREMENT BY 2 MINVALUE 10 MAXVALUE 1000 START WITH 10 CACHE 5 CYCLE`,
        ],
        expectedMasterDependencies: [],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "sequence:test_schema.custom_seq",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
      });
    });

    test("drop sequence", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE SEQUENCE test_schema.test_seq;
        `,
        testSql: "DROP SEQUENCE test_schema.test_seq;",
        description: "drop sequence",
        expectedSqlTerms: [`DROP SEQUENCE test_schema.test_seq`],
        expectedMasterDependencies: [
          {
            dependent_stable_id: "sequence:test_schema.test_seq",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
        expectedBranchDependencies: [],
      });
    });

    // TODO: Fix sequence-table dependency cycle detection
    test("create table with serial column (sequence dependency)", async ({
      db,
    }) => {
      await roundtripFidelityTest({
        masterSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: `
          CREATE TABLE test_schema.users (
            id SERIAL PRIMARY KEY,
            name TEXT
          );
        `,
        description: "create table with serial column (sequence dependency)",
        expectedSqlTerms: [
          `CREATE SEQUENCE test_schema.users_id_seq AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE`,
          `CREATE TABLE test_schema.users (id integer DEFAULT nextval('test_schema.users_id_seq'::regclass) NOT NULL, name text)`,
          `ALTER TABLE test_schema.users ADD CONSTRAINT users_pkey PRIMARY KEY (id)`,
          `ALTER SEQUENCE test_schema.users_id_seq OWNED BY test_schema.users.id`,
        ],
        expectedMasterDependencies: [],
        // Serial column creates multiple dependencies:
        expectedBranchDependencies: [
          {
            dependent_stable_id: "sequence:test_schema.users_id_seq",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          }, // sequence depends on schema
          {
            dependent_stable_id: "sequence:test_schema.users_id_seq",
            referenced_stable_id: "table:test_schema.users",
            deptype: "n",
          }, // sequence owned by table
          {
            dependent_stable_id: "table:test_schema.users",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          }, // table depends on schema
          {
            dependent_stable_id: "constraint:test_schema.users.users_pkey",
            referenced_stable_id: "table:test_schema.users",
            deptype: "a",
          }, // constraint depends on table
          {
            dependent_stable_id: "index:test_schema.users_pkey",
            referenced_stable_id: "constraint:test_schema.users.users_pkey",
            deptype: "i",
          }, // index depends on constraint
        ],
      });
    });

    test("alter sequence properties", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE SEQUENCE test_schema.test_seq INCREMENT BY 1 CACHE 1;
        `,
        testSql: `
          ALTER SEQUENCE test_schema.test_seq INCREMENT BY 5 CACHE 10;
        `,
        description: "alter sequence properties",
        expectedSqlTerms: [
          `ALTER SEQUENCE test_schema.test_seq INCREMENT BY 5 CACHE 10`,
        ],
        expectedMasterDependencies: [
          {
            dependent_stable_id: "sequence:test_schema.test_seq",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "sequence:test_schema.test_seq",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
      });
    });
  });
}
