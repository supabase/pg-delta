/**
 * Integration tests for sensitive information and environment-dependent value handling.
 *
 * This file covers two related concerns:
 * 1. Masking/Placeholders: Sensitive values are replaced with placeholders in CREATE statements
 * 2. Diff Filtering: Environment-dependent value changes are ignored during diff (SET actions filtered)
 */

import dedent from "dedent";
import { describe } from "vitest";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { getTest, getTestIsolated } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTest(pgVersion);
  const testIsolated = getTestIsolated(pgVersion);

  describe.concurrent(`sensitive and env-dependent handling (pg${pgVersion})`, () => {
    describe("masking and placeholders (CREATE operations)", () => {
      testIsolated(
        "role with LOGIN generates password warning",
        async ({ db }) => {
          await roundtripFidelityTest({
            mainSession: db.main,
            branchSession: db.branch,
            testSql: `CREATE ROLE test_login_role WITH LOGIN;`,
            expectedSqlTerms: [
              dedent`
                  -- WARNING: Role requires password to be set manually
                  -- Run: ALTER ROLE test_login_role PASSWORD '<your-password-here>';
                  CREATE ROLE test_login_role WITH LOGIN
                `,
            ],
          });
        },
      );

      testIsolated(
        "role without LOGIN does not generate password warning",
        async ({ db }) => {
          await roundtripFidelityTest({
            mainSession: db.main,
            branchSession: db.branch,
            testSql: `CREATE ROLE test_no_login_role WITH NOLOGIN;`,
            expectedSqlTerms: ["CREATE ROLE test_no_login_role"],
          });
        },
      );

      test("subscription with password in conninfo is masked", async ({
        db,
      }) => {
        const [{ name: mainDbName }] =
          await db.main`select current_database() as name`;

        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `CREATE PUBLICATION sub_sensitive_pub FOR ALL TABLES;`,
          testSql: `
              CREATE SUBSCRIPTION sub_sensitive
                CONNECTION 'dbname=${mainDbName} password=secret123'
                PUBLICATION sub_sensitive_pub
                WITH (
                  connect = false,
                  create_slot = false,
                  enabled = false,
                  slot_name = NONE
                );
            `,
          expectedSqlTerms: [
            dedent`
                -- WARNING: Connection string is environment-dependent
                -- Replace the placeholder values (__CONN_HOST__, __CONN_PORT__, __CONN_DBNAME__, __CONN_USER__, __CONN_PASSWORD__) in the connection string with actual values for subscription sub_sensitive, or run ALTER SUBSCRIPTION sub_sensitive CONNECTION after this script.
                CREATE SUBSCRIPTION sub_sensitive CONNECTION 'host=__CONN_HOST__ port=__CONN_PORT__ dbname=__CONN_DBNAME__ user=__CONN_USER__ password=__CONN_PASSWORD__' PUBLICATION sub_sensitive_pub WITH (enabled = false, slot_name = NONE, create_slot = false, connect = false)`,
          ],
          postMigrationSql: `
              ALTER SUBSCRIPTION sub_sensitive CONNECTION 'dbname=${mainDbName} password=secret123';
            `,
        });
      });

      test("server with options are masked", async ({ db }) => {
        // Note: postgres_fdw doesn't accept password/user in server options,
        // so we test with a custom FDW that accepts arbitrary options
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          testSql: `
              CREATE FOREIGN DATA WRAPPER test_sensitive_fdw;
              CREATE SERVER test_sensitive_server2
                FOREIGN DATA WRAPPER test_sensitive_fdw
                OPTIONS (password 'secret123', user 'testuser', host 'localhost');
            `,
          expectedSqlTerms: [
            "CREATE FOREIGN DATA WRAPPER test_sensitive_fdw NO HANDLER NO VALIDATOR",
            dedent`
                -- WARNING: Server contains options (password, user, host)
                -- Replace the placeholders in the OPTIONS clause with actual values, or run ALTER SERVER test_sensitive_server2 after this script
                CREATE SERVER test_sensitive_server2 FOREIGN DATA WRAPPER test_sensitive_fdw OPTIONS (password '__OPTION_PASSWORD__', user '__OPTION_USER__', host '__OPTION_HOST__')
              `,
          ],
          postMigrationSql: `
              ALTER SERVER test_sensitive_server2 OPTIONS (SET password 'secret123', SET user 'testuser', SET host 'localhost');
            `,
        });
      });

      test("user mapping with options are masked", async ({ db }) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
              CREATE EXTENSION IF NOT EXISTS postgres_fdw;
            `,
          testSql: `
              CREATE SERVER test_um_server
                FOREIGN DATA WRAPPER postgres_fdw
                OPTIONS (host 'localhost');
              CREATE USER MAPPING FOR CURRENT_USER
                SERVER test_um_server
                OPTIONS (user 'testuser', password 'secret456');
            `,
          expectedSqlTerms: [
            dedent`
                -- WARNING: Server contains options (host)
                -- Replace the placeholders in the OPTIONS clause with actual values, or run ALTER SERVER test_um_server after this script
                CREATE SERVER test_um_server FOREIGN DATA WRAPPER postgres_fdw OPTIONS (host '__OPTION_HOST__')
              `,
            dedent`
                -- WARNING: User mapping contains options (user, password)
                -- Replace the placeholders in the OPTIONS clause with actual values, or run ALTER USER MAPPING after this script
                CREATE USER MAPPING FOR postgres SERVER test_um_server OPTIONS (user '__OPTION_USER__', password '__OPTION_PASSWORD__')
              `,
          ],
          postMigrationSql: `
              ALTER SERVER test_um_server OPTIONS (SET host 'localhost');
              ALTER USER MAPPING FOR postgres SERVER test_um_server OPTIONS (SET user 'testuser', SET password 'secret456');
            `,
        });
      });
    });

    describe("diff filtering (ALTER operations)", () => {
      testIsolated(
        "alter role password does not generate ALTER statement",
        async ({ db }) => {
          await roundtripFidelityTest({
            mainSession: db.main,
            branchSession: db.branch,
            initialSetup: `
                CREATE ROLE test_password_role WITH LOGIN;
              `,
            testSql: `
                ALTER ROLE test_password_role PASSWORD 'newpassword123';
              `,
            // Password changes are environment-dependent and should be ignored during diff
            expectedSqlTerms: [],
          });
        },
      );

      test("alter subscription connection with password is ignored", async ({
        db,
      }) => {
        const [{ name: mainDbName }] =
          await db.main`select current_database() as name`;

        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
              CREATE PUBLICATION sub_alter_sensitive_pub FOR ALL TABLES;
              CREATE SUBSCRIPTION sub_alter_sensitive
                CONNECTION 'dbname=${mainDbName}'
                PUBLICATION sub_alter_sensitive_pub
                WITH (
                  connect = false,
                  create_slot = false,
                  enabled = false,
                  slot_name = NONE
                );
            `,
          testSql: `
              ALTER SUBSCRIPTION sub_alter_sensitive
                CONNECTION 'dbname=${mainDbName} password=newsecret';
            `,
          // Conninfo changes are environment-dependent and should be ignored during diff
          expectedSqlTerms: [],
        });
      });

      test("subscription: changing conninfo does not generate ALTER", async ({
        db,
      }) => {
        const [{ name: mainDbName }] =
          await db.main`select current_database() as name`;

        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
              CREATE PUBLICATION sub_env_pub FOR ALL TABLES;
              CREATE SUBSCRIPTION sub_env
                CONNECTION 'dbname=${mainDbName} host=prod.example.com port=5432'
                PUBLICATION sub_env_pub
                WITH (
                  connect = false,
                  create_slot = false,
                  enabled = false,
                  slot_name = NONE
                );
            `,
          testSql: `
              ALTER SUBSCRIPTION sub_env
                CONNECTION 'dbname=${mainDbName} host=dev.example.com port=5433';
            `,
          // Conninfo changes are environment-dependent and should be ignored
          expectedSqlTerms: [],
        });
      });

      test("subscription: changing non-conninfo properties still generates ALTER", async ({
        db,
      }) => {
        const [{ name: mainDbName }] =
          await db.main`select current_database() as name`;

        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
              CREATE PUBLICATION sub_env_pub FOR ALL TABLES;
              CREATE SUBSCRIPTION sub_env
                CONNECTION 'dbname=${mainDbName}'
                PUBLICATION sub_env_pub
                WITH (
                  connect = false,
                  create_slot = false,
                  enabled = false,
                  slot_name = NONE
                );
            `,
          testSql: `
              ALTER SUBSCRIPTION sub_env SET (binary = true);
            `,
          expectedSqlTerms: ["ALTER SUBSCRIPTION sub_env SET (binary = true)"],
        });
      });

      test("server: SET option changes do not generate ALTER", async ({
        db,
      }) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
              CREATE FOREIGN DATA WRAPPER test_env_fdw;
              CREATE SERVER test_env_server
                FOREIGN DATA WRAPPER test_env_fdw
                OPTIONS (host 'prod.example.com', port '5432', dbname 'prod_db', fetch_size '100');
            `,
          testSql: `
              ALTER SERVER test_env_server OPTIONS (
                SET host 'dev.example.com',
                SET port '5433',
                SET dbname 'dev_db',
                SET fetch_size '200'
              );
            `,
          // SET actions are filtered out, so no ALTER should be generated
          expectedSqlTerms: [],
        });
      });

      test("server: adding options generates ALTER (ADD not filtered)", async ({
        db,
      }) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
              CREATE FOREIGN DATA WRAPPER test_env_fdw;
              CREATE SERVER test_env_server
                FOREIGN DATA WRAPPER test_env_fdw
                OPTIONS (fetch_size '100');
            `,
          testSql: `
              ALTER SERVER test_env_server OPTIONS (
                ADD host 'dev.example.com',
                ADD port '5433'
              );
            `,
          // ADD actions are not filtered, so ALTER should be generated
          expectedSqlTerms: [
            dedent`
                -- WARNING: Server options contain values (host, port)
                -- Replace the placeholders in the OPTIONS clause with actual values before executing
                ALTER SERVER test_env_server OPTIONS (ADD host '__OPTION_HOST__', ADD port '__OPTION_PORT__')
              `,
          ],
        });
      });

      test("user mapping: SET option changes do not generate ALTER", async ({
        db,
      }) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
              CREATE EXTENSION IF NOT EXISTS postgres_fdw;
              CREATE SERVER test_um_server
                FOREIGN DATA WRAPPER postgres_fdw
                OPTIONS (host 'localhost');
              CREATE USER MAPPING FOR CURRENT_USER
                SERVER test_um_server
                OPTIONS (user 'prod_user', password 'prod_pass');
            `,
          testSql: `
              ALTER USER MAPPING FOR CURRENT_USER
                SERVER test_um_server
                OPTIONS (
                  SET user 'dev_user',
                  SET password 'dev_pass'
                );
            `,
          // SET actions are filtered out, so no ALTER should be generated
          expectedSqlTerms: [],
        });
      });
    });
  });
}
