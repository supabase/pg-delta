import dedent from "dedent";
import { describe } from "vitest";
import type { Change } from "../../src/core/change.types.ts";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { getTest } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTest(pgVersion);

  describe.concurrent(`rule operations (pg${pgVersion})`, () => {
    test("create rule", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: dedent`
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.accounts (
            id serial PRIMARY KEY,
            balance numeric NOT NULL DEFAULT 0
          );
        `,
        testSql: dedent`
          CREATE RULE prevent_negative_balance AS
            ON INSERT TO test_schema.accounts
            WHERE NEW.balance < 0
            DO INSTEAD NOTHING;
        `,
      });
    });

    test("drop rule", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: dedent`
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.accounts (
            id serial PRIMARY KEY,
            balance numeric NOT NULL DEFAULT 0
          );
          CREATE RULE prevent_negative_balance AS
            ON INSERT TO test_schema.accounts
            WHERE NEW.balance < 0
            DO INSTEAD NOTHING;
        `,
        testSql: `DROP RULE prevent_negative_balance ON test_schema.accounts;`,
      });
    });

    test("replace rule definition", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: dedent`
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.accounts (
            id serial PRIMARY KEY,
            balance numeric NOT NULL DEFAULT 0
          );
          CREATE TABLE test_schema.rule_events (
            message text NOT NULL,
            created_at timestamptz DEFAULT now()
          );
          CREATE RULE prevent_negative_balance AS
            ON INSERT TO test_schema.accounts
            WHERE NEW.balance < 0
            DO INSTEAD NOTHING;
        `,
        testSql: dedent`
          CREATE OR REPLACE RULE prevent_negative_balance AS
            ON INSERT TO test_schema.accounts
            WHERE NEW.balance < 0
            DO ALSO INSERT INTO test_schema.rule_events (message)
              VALUES ('negative balance attempt detected');
        `,
      });
    });

    test("rule comments", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: dedent`
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.accounts (
            id serial PRIMARY KEY,
            balance numeric NOT NULL DEFAULT 0
          );
          CREATE RULE prevent_negative_balance AS
            ON INSERT TO test_schema.accounts
            WHERE NEW.balance < 0
            DO INSTEAD NOTHING;
        `,
        testSql: `COMMENT ON RULE prevent_negative_balance ON test_schema.accounts IS 'prevent inserting negative balances';`,
      });
    });

    test("rule enabled state", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: dedent`
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.accounts (
            id serial PRIMARY KEY,
            balance numeric NOT NULL DEFAULT 0
          );
          CREATE RULE prevent_negative_balance AS
            ON INSERT TO test_schema.accounts
            WHERE NEW.balance < 0
            DO INSTEAD NOTHING;
        `,
        testSql: `ALTER TABLE test_schema.accounts DISABLE RULE prevent_negative_balance;`,
      });
    });

    test("rule enable always state", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: dedent`
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.accounts (
            id serial PRIMARY KEY,
            balance numeric NOT NULL DEFAULT 0
          );
          CREATE RULE prevent_negative_balance AS
            ON INSERT TO test_schema.accounts
            WHERE NEW.balance < 0
            DO INSTEAD NOTHING;
          ALTER TABLE test_schema.accounts DISABLE RULE prevent_negative_balance;
        `,
        testSql: `ALTER TABLE test_schema.accounts ENABLE ALWAYS RULE prevent_negative_balance;`,
      });
    });

    test("rule creation depends on newly added column", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: dedent`
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.accounts (
            id serial PRIMARY KEY,
            note text
          );
        `,
        testSql: dedent`
          ALTER TABLE test_schema.accounts
            ADD COLUMN flagged boolean;

          CREATE RULE prevent_flagged_insert AS
            ON INSERT TO test_schema.accounts
            WHERE NEW.flagged
            DO INSTEAD NOTHING;
        `,
        sortChangesCallback: (a, b) => {
          // force create rule before alter table to test that we track the dependency rule -> column
          const priority = (change: Change) => {
            if (change.objectType === "rule" && change.operation === "create") {
              return 0;
            }
            if (change.objectType === "table" && change.operation === "alter") {
              return 1;
            }
            return 2;
          };
          return priority(a) - priority(b);
        },
      });
    });
  });
}
