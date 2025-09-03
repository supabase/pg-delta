/**
 * Integration tests for PostgreSQL constraint operations.
 */

import { describe } from "vitest";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { getTest } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTest(pgVersion);

  // TODO: Fix constraint dependency detection issues - many complex dependencies
  describe.skip(`constraint operations (pg${pgVersion})`, () => {
    test("add primary key constraint", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.users (
            id integer NOT NULL,
            email character varying(255) NOT NULL
          );
        `,
        testSql: `
          ALTER TABLE test_schema.users ADD CONSTRAINT users_pkey PRIMARY KEY (id);
        `,
        description: "add primary key constraint",
        expectedSqlTerms: [
          `ALTER TABLE test_schema.users ADD CONSTRAINT users_pkey PRIMARY KEY (id)`,
        ],
        expectedMasterDependencies: [
          {
            dependent_stable_id: "table:test_schema.users",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "table:test_schema.users",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "constraint:test_schema.users.users_pkey",
            referenced_stable_id: "table:test_schema.users",
            deptype: "a",
          },
          {
            dependent_stable_id: "index:test_schema.users_pkey",
            referenced_stable_id: "constraint:test_schema.users.users_pkey",
            deptype: "i",
          },
        ],
      });
    });

    test("add unique constraint", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.users (
            id integer NOT NULL,
            email character varying(255) NOT NULL
          );
        `,
        testSql: `
          ALTER TABLE test_schema.users ADD CONSTRAINT users_email_key UNIQUE (email);
        `,
        description: "add unique constraint",
        expectedSqlTerms: [
          `ALTER TABLE test_schema.users ADD CONSTRAINT users_email_key UNIQUE (email)`,
        ],
        expectedMasterDependencies: [
          {
            dependent_stable_id: "table:test_schema.users",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "table:test_schema.users",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "constraint:test_schema.users.users_email_key",
            referenced_stable_id: "table:test_schema.users",
            deptype: "a",
          },
          {
            dependent_stable_id: "index:test_schema.users_email_key",
            referenced_stable_id:
              "constraint:test_schema.users.users_email_key",
            deptype: "i",
          },
        ],
      });
    });

    test("add check constraint", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.products (
            id integer NOT NULL,
            price numeric(10,2) NOT NULL
          );
        `,
        testSql: `
          ALTER TABLE test_schema.products ADD CONSTRAINT products_price_check CHECK (price > 0);
        `,
        description: "add check constraint",
        expectedSqlTerms: [
          `ALTER TABLE test_schema.products ADD CONSTRAINT products_price_check CHECK ((price > (0)::numeric))`,
        ],
        expectedMasterDependencies: [
          {
            dependent_stable_id: "table:test_schema.products",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "table:test_schema.products",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id:
              "constraint:test_schema.products.products_price_check",
            referenced_stable_id: "table:test_schema.products",
            deptype: "a",
          },
        ],
      });
    });

    test("drop primary key constraint", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.users (
            id integer NOT NULL,
            email character varying(255) NOT NULL,
            CONSTRAINT users_pkey PRIMARY KEY (id)
          );
        `,
        testSql: `
          ALTER TABLE test_schema.users DROP CONSTRAINT users_pkey;
        `,
        description: "drop primary key constraint",
        expectedSqlTerms: [
          `ALTER TABLE test_schema.users DROP CONSTRAINT users_pkey`,
        ],
        expectedMasterDependencies: [
          {
            dependent_stable_id: "table:test_schema.users",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "constraint:test_schema.users.users_pkey",
            referenced_stable_id: "table:test_schema.users",
            deptype: "a",
          },
          {
            dependent_stable_id: "index:test_schema.users_pkey",
            referenced_stable_id: "constraint:test_schema.users.users_pkey",
            deptype: "i",
          },
        ],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "table:test_schema.users",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
      });
    });
  });
}
