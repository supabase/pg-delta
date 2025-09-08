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
  describe.concurrent(`constraint operations (pg${pgVersion})`, () => {
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

    test("add foreign key constraint", async ({ db }) => {
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
          CREATE TABLE test_schema.orders (
            id integer NOT NULL,
            user_id integer NOT NULL
          );
        `,
        testSql: `
          ALTER TABLE test_schema.orders ADD CONSTRAINT orders_user_id_fkey
            FOREIGN KEY (user_id) REFERENCES test_schema.users (id) ON DELETE CASCADE;
        `,
        description: "add foreign key constraint",
        expectedSqlTerms: [
          "ALTER TABLE test_schema.orders ADD CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES test_schema.users (id) ON DELETE CASCADE",
        ],
        expectedMasterDependencies: [
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
          {
            dependent_stable_id: "table:test_schema.orders",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "table:test_schema.users",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
        expectedBranchDependencies: [
          {
            dependent_stable_id:
              "constraint:test_schema.orders.orders_user_id_fkey",
            referenced_stable_id: "table:test_schema.orders",
            deptype: "a",
          },
          {
            dependent_stable_id:
              "constraint:test_schema.orders.orders_user_id_fkey",
            referenced_stable_id: "table:test_schema.users",
            deptype: "n",
          },
          {
            dependent_stable_id:
              "constraint:test_schema.orders.orders_user_id_fkey",
            referenced_stable_id: "index:test_schema.users_pkey",
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
          {
            dependent_stable_id: "table:test_schema.orders",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "table:test_schema.users",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
      });
    });

    test("drop unique constraint", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.users (
            id integer NOT NULL,
            email character varying(255) NOT NULL,
            CONSTRAINT users_email_key UNIQUE (email)
          );
        `,
        testSql: `
          ALTER TABLE test_schema.users DROP CONSTRAINT users_email_key;
        `,
        description: "drop unique constraint",
        expectedSqlTerms: [
          "ALTER TABLE test_schema.users DROP CONSTRAINT users_email_key",
        ],
        expectedMasterDependencies: [
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
        ],
      });
    });

    test("drop check constraint", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.products (
            id integer NOT NULL,
            price numeric(10,2) NOT NULL,
            CONSTRAINT products_price_check CHECK (price > 0)
          );
        `,
        testSql: `
          ALTER TABLE test_schema.products DROP CONSTRAINT products_price_check;
        `,
        description: "drop check constraint",
        expectedSqlTerms: [
          "ALTER TABLE test_schema.products DROP CONSTRAINT products_price_check",
        ],
        expectedMasterDependencies: [
          {
            dependent_stable_id:
              "constraint:test_schema.products.products_price_check",
            referenced_stable_id: "table:test_schema.products",
            deptype: "a",
          },
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
        ],
      });
    });

    test("drop foreign key constraint", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.users (
            id integer NOT NULL,
            CONSTRAINT users_pkey PRIMARY KEY (id)
          );
          CREATE TABLE test_schema.orders (
            id integer NOT NULL,
            user_id integer NOT NULL,
            CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES test_schema.users (id)
          );
        `,
        testSql: `
          ALTER TABLE test_schema.orders DROP CONSTRAINT orders_user_id_fkey;
        `,
        description: "drop foreign key constraint",
        expectedSqlTerms: [
          "ALTER TABLE test_schema.orders DROP CONSTRAINT orders_user_id_fkey",
        ],
        expectedMasterDependencies: [
          {
            dependent_stable_id:
              "constraint:test_schema.orders.orders_user_id_fkey",
            referenced_stable_id: "table:test_schema.orders",
            deptype: "a",
          },
          {
            dependent_stable_id:
              "constraint:test_schema.orders.orders_user_id_fkey",
            referenced_stable_id: "table:test_schema.users",
            deptype: "n",
          },
          {
            dependent_stable_id:
              "constraint:test_schema.orders.orders_user_id_fkey",
            referenced_stable_id: "index:test_schema.users_pkey",
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
          {
            dependent_stable_id: "table:test_schema.orders",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "table:test_schema.users",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
        expectedBranchDependencies: [
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
          {
            dependent_stable_id: "table:test_schema.orders",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
          {
            dependent_stable_id: "table:test_schema.users",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
      });
    });

    test("add multiple constraints to same table", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.users (
            id integer NOT NULL,
            email character varying(255) NOT NULL,
            age integer
          );
        `,
        testSql: `
          ALTER TABLE test_schema.users ADD CONSTRAINT users_pkey PRIMARY KEY (id);
          ALTER TABLE test_schema.users ADD CONSTRAINT users_email_key UNIQUE (email);
          ALTER TABLE test_schema.users ADD CONSTRAINT users_age_check CHECK (age >= 0);
        `,
        description: "add multiple constraints to same table",
        expectedSqlTerms: [
          "ALTER TABLE test_schema.users ADD CONSTRAINT users_age_check CHECK ((age >= 0))",
          "ALTER TABLE test_schema.users ADD CONSTRAINT users_email_key UNIQUE (email)",
          "ALTER TABLE test_schema.users ADD CONSTRAINT users_pkey PRIMARY KEY (id)",
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
            dependent_stable_id: "constraint:test_schema.users.users_pkey",
            referenced_stable_id: "table:test_schema.users",
            deptype: "a",
          },
          {
            dependent_stable_id: "constraint:test_schema.users.users_email_key",
            referenced_stable_id: "table:test_schema.users",
            deptype: "a",
          },
          {
            dependent_stable_id: "constraint:test_schema.users.users_age_check",
            referenced_stable_id: "table:test_schema.users",
            deptype: "a",
          },
          {
            dependent_stable_id: "index:test_schema.users_pkey",
            referenced_stable_id: "constraint:test_schema.users.users_pkey",
            deptype: "i",
          },
          {
            dependent_stable_id: "index:test_schema.users_email_key",
            referenced_stable_id:
              "constraint:test_schema.users.users_email_key",
            deptype: "i",
          },
          {
            dependent_stable_id: "table:test_schema.users",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
      });
    });

    test("constraint with special characters in names", async ({ db }) => {
      await roundtripFidelityTest({
        masterSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA "my-schema";
          CREATE TABLE "my-schema"."my-table" (
            id integer NOT NULL,
            "my-field" text
          );
        `,
        testSql: `
          ALTER TABLE "my-schema"."my-table" ADD CONSTRAINT "my-table_check$constraint"
            CHECK ("my-field" IS NOT NULL);
        `,
        description: "constraint with special characters in names",
        expectedSqlTerms: [
          'ALTER TABLE "my-schema"."my-table" ADD CONSTRAINT "my-table_check$constraint" CHECK (("my-field" IS NOT NULL))',
        ],
        expectedMasterDependencies: [
          {
            dependent_stable_id: "table:my-schema.my-table",
            referenced_stable_id: "schema:my-schema",
            deptype: "n",
          },
        ],
        expectedBranchDependencies: [
          {
            dependent_stable_id:
              "constraint:my-schema.my-table.my-table_check$constraint",
            referenced_stable_id: "table:my-schema.my-table",
            deptype: "a",
          },
          {
            dependent_stable_id: "table:my-schema.my-table",
            referenced_stable_id: "schema:my-schema",
            deptype: "n",
          },
        ],
      });
    });
  });
}
