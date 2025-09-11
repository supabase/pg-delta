/**
 * Integration tests for PostgreSQL ALTER TABLE operations.
 */

import { describe } from "vitest";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { getTest } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTest(pgVersion);

  // TODO: Fix ALTER TABLE operations dependency detection issues
  describe.concurrent(`alter table operations (pg${pgVersion})`, () => {
    test("add column to existing table", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.users (
            id integer NOT NULL
          );
        `,
        testSql: `
          ALTER TABLE test_schema.users ADD COLUMN email character varying(255) NOT NULL DEFAULT 'user@example.com';
        `,
        description: "add column to existing table",
        expectedSqlTerms: [
          "ALTER TABLE test_schema.users ADD COLUMN email character varying(255) DEFAULT 'user@example.com'::character varying NOT NULL",
        ],
        expectedMainDependencies: [
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

    test("drop column from existing table", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.products (
            id integer NOT NULL,
            name text NOT NULL,
            old_field text,
            description text
          );
        `,
        testSql: `
          ALTER TABLE test_schema.products DROP COLUMN old_field;
        `,
        description: "drop column from existing table",
        expectedSqlTerms: [
          "ALTER TABLE test_schema.products DROP COLUMN old_field",
        ],
        expectedMainDependencies: [
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

    test("change column type", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.conversions (
            id integer NOT NULL,
            price numeric(8,2),
            status_code smallint
          );
        `,
        testSql: `
          ALTER TABLE test_schema.conversions ALTER COLUMN price TYPE numeric(12,4);
        `,
        description: "change column type",
        expectedSqlTerms: [
          "ALTER TABLE test_schema.conversions ALTER COLUMN price TYPE numeric(12,4)",
        ],
        expectedMainDependencies: [
          {
            dependent_stable_id: "table:test_schema.conversions",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "table:test_schema.conversions",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
      });
    });

    test("set column default", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.settings (
            id integer NOT NULL,
            enabled boolean,
            created_at timestamp
          );
        `,
        testSql: `
          ALTER TABLE test_schema.settings ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP;
        `,
        description: "set column default",
        expectedSqlTerms: [
          "ALTER TABLE test_schema.settings ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP",
        ],
        expectedMainDependencies: [
          {
            dependent_stable_id: "table:test_schema.settings",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "table:test_schema.settings",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
      });
    });

    test("drop column default", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.configs (
            id integer NOT NULL,
            status text DEFAULT 'pending',
            value text
          );
        `,
        testSql: `
          ALTER TABLE test_schema.configs ALTER COLUMN status DROP DEFAULT;
        `,
        description: "drop column default",
        expectedSqlTerms: [
          "ALTER TABLE test_schema.configs ALTER COLUMN status DROP DEFAULT",
        ],
        expectedMainDependencies: [
          {
            dependent_stable_id: "table:test_schema.configs",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "table:test_schema.configs",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
      });
    });

    test("set column not null", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.users (
            id integer NOT NULL,
            name text
          );
          INSERT INTO test_schema.users (id, name) VALUES (1, 'Test User');
        `,
        testSql: `
          ALTER TABLE test_schema.users ALTER COLUMN name SET NOT NULL;
        `,
        description: "set column not null",
        expectedSqlTerms: [
          "ALTER TABLE test_schema.users ALTER COLUMN name SET NOT NULL",
        ],
        expectedMainDependencies: [
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

    test("drop column not null", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.profiles (
            id integer NOT NULL,
            email text NOT NULL,
            phone text
          );
        `,
        testSql: `
          ALTER TABLE test_schema.profiles ALTER COLUMN email DROP NOT NULL;
        `,
        description: "drop column not null",
        expectedSqlTerms: [
          "ALTER TABLE test_schema.profiles ALTER COLUMN email DROP NOT NULL",
        ],
        expectedMainDependencies: [
          {
            dependent_stable_id: "table:test_schema.profiles",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "table:test_schema.profiles",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
      });
    });

    test("multiple alter operations - state-based diffing", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.evolution (
            id integer NOT NULL,
            old_name varchar(50),
            status text DEFAULT 'pending'
          );
        `,
        testSql: `
          ALTER TABLE test_schema.evolution ADD COLUMN email character varying(255);
          ALTER TABLE test_schema.evolution ALTER COLUMN old_name TYPE text;
          ALTER TABLE test_schema.evolution ALTER COLUMN status DROP DEFAULT;
          ALTER TABLE test_schema.evolution DROP COLUMN status;
        `,
        description: "multiple alter operations - state-based diffing",
        expectedSqlTerms: [
          "ALTER TABLE test_schema.evolution ADD COLUMN email character varying(255)",
          "ALTER TABLE test_schema.evolution DROP COLUMN status",
          "ALTER TABLE test_schema.evolution ALTER COLUMN old_name TYPE text",
        ],
        expectedMainDependencies: [
          {
            dependent_stable_id: "table:test_schema.evolution",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "table:test_schema.evolution",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
      });
    });

    test("complex column changes", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.complex_changes (
            id integer NOT NULL,
            email text,
            status varchar(20) DEFAULT 'active',
            created_at timestamp
          );
        `,
        testSql: `
          ALTER TABLE test_schema.complex_changes ALTER COLUMN email TYPE character varying(255);
          ALTER TABLE test_schema.complex_changes ALTER COLUMN email SET NOT NULL;
          ALTER TABLE test_schema.complex_changes ALTER COLUMN email SET DEFAULT 'user@example.com';
          ALTER TABLE test_schema.complex_changes ALTER COLUMN status DROP DEFAULT;
          ALTER TABLE test_schema.complex_changes ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP;
        `,
        description: "complex column changes",
        expectedSqlTerms: [
          "ALTER TABLE test_schema.complex_changes ALTER COLUMN email TYPE character varying(255)",
          "ALTER TABLE test_schema.complex_changes ALTER COLUMN email SET DEFAULT 'user@example.com'::character varying",
          "ALTER TABLE test_schema.complex_changes ALTER COLUMN email SET NOT NULL",
          "ALTER TABLE test_schema.complex_changes ALTER COLUMN status DROP DEFAULT",
          "ALTER TABLE test_schema.complex_changes ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP",
        ],
        expectedMainDependencies: [
          {
            dependent_stable_id: "table:test_schema.complex_changes",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "table:test_schema.complex_changes",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
      });
    });

    test("generated column operations", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.users (
            id integer NOT NULL,
            first_name text NOT NULL,
            last_name text NOT NULL
          );
        `,
        testSql: `
          ALTER TABLE test_schema.users ADD COLUMN full_name text GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED;
          ALTER TABLE test_schema.users ADD COLUMN email character varying(255) DEFAULT 'user@example.com';
        `,
        description: "generated column operations",
        expectedSqlTerms: [
          "ALTER TABLE test_schema.users ADD COLUMN full_name text GENERATED ALWAYS AS ((first_name || ' '::text) || last_name) STORED",
          "ALTER TABLE test_schema.users ADD COLUMN email character varying(255) DEFAULT 'user@example.com'::character varying",
        ],
        expectedMainDependencies: [
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

    test("drop generated column", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.products (
            id integer NOT NULL,
            price numeric(10,2) NOT NULL,
            tax_rate numeric(5,4) DEFAULT 0.0875,
            total_price numeric(10,2) GENERATED ALWAYS AS (price * (1 + tax_rate)) STORED
          );
        `,
        testSql: `
          ALTER TABLE test_schema.products DROP COLUMN total_price;
        `,
        description: "drop generated column",
        expectedSqlTerms: [
          "ALTER TABLE test_schema.products DROP COLUMN total_price",
        ],
        expectedMainDependencies: [
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

    test("alter generated column expression", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.calculations (
            id integer NOT NULL,
            value_a numeric NOT NULL,
            value_b numeric NOT NULL,
            computed numeric GENERATED ALWAYS AS (value_a + value_b) STORED
          );
        `,
        testSql: `
          ALTER TABLE test_schema.calculations DROP COLUMN computed;
          ALTER TABLE test_schema.calculations ADD COLUMN computed numeric GENERATED ALWAYS AS (value_a * value_b) STORED;
        `,
        description: "alter generated column expression",
        expectedSqlTerms:
          pgVersion === 15
            ? [
                "ALTER TABLE test_schema.calculations DROP COLUMN computed",
                "ALTER TABLE test_schema.calculations ADD COLUMN computed numeric GENERATED ALWAYS AS (value_a * value_b) STORED",
              ]
            : [
                "ALTER TABLE test_schema.calculations ALTER COLUMN computed SET EXPRESSION AS (value_a * value_b)",
              ],
        expectedMainDependencies: [
          {
            dependent_stable_id: "table:test_schema.calculations",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
        expectedBranchDependencies: [
          {
            dependent_stable_id: "table:test_schema.calculations",
            referenced_stable_id: "schema:test_schema",
            deptype: "n",
          },
        ],
      });
    });
  });
}
