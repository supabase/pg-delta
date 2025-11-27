/**
 * Integration tests for PostgreSQL Foreign Data Wrapper operations.
 */

import dedent from "dedent";
import { describe } from "vitest";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { getTestIsolated } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTestIsolated(pgVersion);

  describe.concurrent(`foreign-data-wrapper operations (pg${pgVersion})`, () => {
    test("create foreign data wrapper basic", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        testSql: `
          CREATE FOREIGN DATA WRAPPER test_fdw;
        `,
      });
    });

    // Note: Handler and validator tests are skipped as they require C modules
    // which are not available in the test environment

    test("create foreign data wrapper with options", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        testSql: `
          CREATE FOREIGN DATA WRAPPER test_fdw OPTIONS (debug 'true');
        `,
      });
    });

    test("create foreign data wrapper with multiple options", async ({
      db,
    }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        testSql: `
          CREATE FOREIGN DATA WRAPPER test_fdw OPTIONS (debug 'true', option1 'value1', option2 'value2');
        `,
      });
    });

    // Note: Owner change test skipped - requires superuser privileges
    // FDW owners must be superusers, which is not available in test environment

    test("alter foreign data wrapper options", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE FOREIGN DATA WRAPPER test_fdw OPTIONS (debug 'true');
        `,
        testSql: `
          ALTER FOREIGN DATA WRAPPER test_fdw OPTIONS (ADD option1 'value1', SET debug 'false');
        `,
      });
    });

    test("drop foreign data wrapper", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE FOREIGN DATA WRAPPER test_fdw;
        `,
        testSql: `
          DROP FOREIGN DATA WRAPPER test_fdw;
        `,
      });
    });

    test("create server basic", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE FOREIGN DATA WRAPPER test_fdw;
        `,
        testSql: `
          CREATE SERVER test_server FOREIGN DATA WRAPPER test_fdw;
        `,
      });
    });

    test("create server with type and version", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE FOREIGN DATA WRAPPER test_fdw;
        `,
        testSql: `
          CREATE SERVER test_server TYPE 'postgres_fdw' VERSION '1.0' FOREIGN DATA WRAPPER test_fdw;
        `,
      });
    });

    test("create server with options", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE FOREIGN DATA WRAPPER test_fdw;
        `,
        testSql: `
          CREATE SERVER test_server FOREIGN DATA WRAPPER test_fdw OPTIONS (host 'localhost', port '5432');
        `,
      });
    });

    test("alter server owner", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE FOREIGN DATA WRAPPER test_fdw;
          CREATE SERVER test_server FOREIGN DATA WRAPPER test_fdw;
          CREATE ROLE server_owner;
        `,
        testSql: `
          ALTER SERVER test_server OWNER TO server_owner;
        `,
      });
    });

    test("alter server version", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE FOREIGN DATA WRAPPER test_fdw;
          CREATE SERVER test_server FOREIGN DATA WRAPPER test_fdw;
        `,
        testSql: `
          ALTER SERVER test_server VERSION '2.0';
        `,
      });
    });

    test("alter server options", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE FOREIGN DATA WRAPPER test_fdw;
          CREATE SERVER test_server FOREIGN DATA WRAPPER test_fdw OPTIONS (host 'localhost');
        `,
        testSql: `
          ALTER SERVER test_server OPTIONS (ADD port '5432', SET host 'newhost');
        `,
      });
    });

    test("drop server", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE FOREIGN DATA WRAPPER test_fdw;
          CREATE SERVER test_server FOREIGN DATA WRAPPER test_fdw;
        `,
        testSql: `
          DROP SERVER test_server;
        `,
      });
    });

    test("create user mapping basic", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE FOREIGN DATA WRAPPER test_fdw;
          CREATE SERVER test_server FOREIGN DATA WRAPPER test_fdw;
        `,
        testSql: `
          CREATE USER MAPPING FOR CURRENT_USER SERVER test_server;
        `,
      });
    });

    test("create user mapping for PUBLIC", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE FOREIGN DATA WRAPPER test_fdw;
          CREATE SERVER test_server FOREIGN DATA WRAPPER test_fdw;
        `,
        testSql: `
          CREATE USER MAPPING FOR PUBLIC SERVER test_server;
        `,
      });
    });

    test("create user mapping with options", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE FOREIGN DATA WRAPPER test_fdw;
          CREATE SERVER test_server FOREIGN DATA WRAPPER test_fdw;
          CREATE ROLE test_user;
        `,
        testSql: `
          CREATE USER MAPPING FOR test_user SERVER test_server OPTIONS (user 'remote_user', password 'secret');
        `,
        postMigrationSql: `
          ALTER USER MAPPING FOR test_user SERVER test_server OPTIONS (SET user 'remote_user', SET password 'secret');
        `,
      });
    });

    test("alter user mapping options", async ({ db }) => {
      // SET actions are filtered out, but ADD actions are not.
      // Since postgres_fdw only supports user/password options, we test with a custom FDW.
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE FOREIGN DATA WRAPPER test_fdw;
          CREATE SERVER test_server FOREIGN DATA WRAPPER test_fdw;
          CREATE USER MAPPING FOR CURRENT_USER SERVER test_server OPTIONS (user 'remote_user');
        `,
        testSql: `
          ALTER USER MAPPING FOR CURRENT_USER SERVER test_server OPTIONS (ADD password 'secret', SET user 'new_user');
        `,
        // SET actions are filtered out, but ADD actions generate ALTER
        // Note: SET user is filtered out, but ADD password remains and is masked
        expectedSqlTerms: [
          dedent`
            -- WARNING: User mapping options contain sensitive/environment-dependent values (password)
            -- Set actual option values after migration execution using: ALTER USER MAPPING ... OPTIONS (SET ...);
            ALTER USER MAPPING FOR postgres SERVER test_server OPTIONS (ADD password '__OPTION_PASSWORD__')
          `,
        ],
      });
    });

    test("drop user mapping", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE FOREIGN DATA WRAPPER test_fdw;
          CREATE SERVER test_server FOREIGN DATA WRAPPER test_fdw;
          CREATE USER MAPPING FOR CURRENT_USER SERVER test_server;
        `,
        testSql: `
          DROP USER MAPPING FOR CURRENT_USER SERVER test_server;
        `,
      });
    });

    test("create foreign table basic", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE FOREIGN DATA WRAPPER test_fdw;
          CREATE SERVER test_server FOREIGN DATA WRAPPER test_fdw;
        `,
        testSql: `
          CREATE FOREIGN TABLE test_schema.test_table (
            id integer,
            name text
          ) SERVER test_server;
        `,
      });
    });

    test("create foreign table with options", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE FOREIGN DATA WRAPPER test_fdw;
          CREATE SERVER test_server FOREIGN DATA WRAPPER test_fdw;
        `,
        testSql: `
          CREATE FOREIGN TABLE test_schema.test_table (
            id integer,
            name text
          ) SERVER test_server OPTIONS (schema_name 'remote_schema', table_name 'remote_table');
        `,
      });
    });

    test("alter foreign table owner", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE FOREIGN DATA WRAPPER test_fdw;
          CREATE SERVER test_server FOREIGN DATA WRAPPER test_fdw;
          CREATE FOREIGN TABLE test_schema.test_table (
            id integer
          ) SERVER test_server;
          CREATE ROLE table_owner;
        `,
        testSql: `
          ALTER FOREIGN TABLE test_schema.test_table OWNER TO table_owner;
        `,
      });
    });

    test("alter foreign table add column", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE FOREIGN DATA WRAPPER test_fdw;
          CREATE SERVER test_server FOREIGN DATA WRAPPER test_fdw;
          CREATE FOREIGN TABLE test_schema.test_table (
            id integer
          ) SERVER test_server;
        `,
        testSql: `
          ALTER FOREIGN TABLE test_schema.test_table ADD COLUMN name text;
        `,
      });
    });

    test("alter foreign table drop column", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE FOREIGN DATA WRAPPER test_fdw;
          CREATE SERVER test_server FOREIGN DATA WRAPPER test_fdw;
          CREATE FOREIGN TABLE test_schema.test_table (
            id integer,
            name text
          ) SERVER test_server;
        `,
        testSql: `
          ALTER FOREIGN TABLE test_schema.test_table DROP COLUMN name;
        `,
      });
    });

    test("alter foreign table alter column type", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE FOREIGN DATA WRAPPER test_fdw;
          CREATE SERVER test_server FOREIGN DATA WRAPPER test_fdw;
          CREATE FOREIGN TABLE test_schema.test_table (
            id integer
          ) SERVER test_server;
        `,
        testSql: `
          ALTER FOREIGN TABLE test_schema.test_table ALTER COLUMN id TYPE bigint;
        `,
      });
    });

    test("alter foreign table alter column set default", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE FOREIGN DATA WRAPPER test_fdw;
          CREATE SERVER test_server FOREIGN DATA WRAPPER test_fdw;
          CREATE FOREIGN TABLE test_schema.test_table (
            id integer
          ) SERVER test_server;
        `,
        testSql: `
          ALTER FOREIGN TABLE test_schema.test_table ALTER COLUMN id SET DEFAULT 0;
        `,
      });
    });

    test("alter foreign table alter column drop default", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE FOREIGN DATA WRAPPER test_fdw;
          CREATE SERVER test_server FOREIGN DATA WRAPPER test_fdw;
          CREATE FOREIGN TABLE test_schema.test_table (
            id integer DEFAULT 0
          ) SERVER test_server;
        `,
        testSql: `
          ALTER FOREIGN TABLE test_schema.test_table ALTER COLUMN id DROP DEFAULT;
        `,
      });
    });

    test("alter foreign table alter column set not null", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE FOREIGN DATA WRAPPER test_fdw;
          CREATE SERVER test_server FOREIGN DATA WRAPPER test_fdw;
          CREATE FOREIGN TABLE test_schema.test_table (
            id integer
          ) SERVER test_server;
        `,
        testSql: `
          ALTER FOREIGN TABLE test_schema.test_table ALTER COLUMN id SET NOT NULL;
        `,
      });
    });

    test("alter foreign table alter column drop not null", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE FOREIGN DATA WRAPPER test_fdw;
          CREATE SERVER test_server FOREIGN DATA WRAPPER test_fdw;
          CREATE FOREIGN TABLE test_schema.test_table (
            id integer NOT NULL
          ) SERVER test_server;
        `,
        testSql: `
          ALTER FOREIGN TABLE test_schema.test_table ALTER COLUMN id DROP NOT NULL;
        `,
      });
    });

    test("alter foreign table options", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE FOREIGN DATA WRAPPER test_fdw;
          CREATE SERVER test_server FOREIGN DATA WRAPPER test_fdw;
          CREATE FOREIGN TABLE test_schema.test_table (
            id integer
          ) SERVER test_server OPTIONS (schema_name 'remote_schema');
        `,
        testSql: `
          ALTER FOREIGN TABLE test_schema.test_table OPTIONS (ADD table_name 'remote_table', SET schema_name 'new_schema');
        `,
      });
    });

    test("drop foreign table", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE FOREIGN DATA WRAPPER test_fdw;
          CREATE SERVER test_server FOREIGN DATA WRAPPER test_fdw;
          CREATE FOREIGN TABLE test_schema.test_table (
            id integer
          ) SERVER test_server;
        `,
        testSql: `
          DROP FOREIGN TABLE test_schema.test_table;
        `,
      });
    });

    test("full FDW lifecycle", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
        `,
        testSql: `
          CREATE FOREIGN DATA WRAPPER test_fdw OPTIONS (debug 'true');
          CREATE SERVER test_server FOREIGN DATA WRAPPER test_fdw OPTIONS (host 'localhost');
          CREATE USER MAPPING FOR CURRENT_USER SERVER test_server OPTIONS (user 'remote_user');
          CREATE FOREIGN TABLE test_schema.test_table (
            id integer,
            name text
          ) SERVER test_server OPTIONS (schema_name 'remote_schema');
        `,
        postMigrationSql: `
          ALTER USER MAPPING FOR postgres SERVER test_server OPTIONS (SET user 'remote_user');
        `,
      });
    });

    test("FDW dependency ordering", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
        `,
        testSql: `
          CREATE FOREIGN DATA WRAPPER fdw1;
          CREATE SERVER server1 FOREIGN DATA WRAPPER fdw1;
          CREATE SERVER server2 FOREIGN DATA WRAPPER fdw1;
          CREATE USER MAPPING FOR CURRENT_USER SERVER server1;
          CREATE USER MAPPING FOR PUBLIC SERVER server2;
          CREATE FOREIGN TABLE test_schema.table1 (
            id integer
          ) SERVER server1;
          CREATE FOREIGN TABLE test_schema.table2 (
            id integer
          ) SERVER server2;
        `,
      });
    });
  });
}
