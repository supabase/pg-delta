import { describe } from "vitest";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { getTest, getTestIsolated } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTest(pgVersion);
  const testIsolated = getTestIsolated(pgVersion);

  describe.concurrent(`subscription operations (pg${pgVersion})`, () => {
    test("create subscription without connecting", async ({ db }) => {
      const [{ name: mainDbName }] =
        await db.main`select current_database() as name`;

      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE PUBLICATION sub_create_pub FOR ALL TABLES;
        `,
        testSql: `
          CREATE SUBSCRIPTION sub_create
            CONNECTION 'dbname=${mainDbName}'
            PUBLICATION sub_create_pub
            WITH (
              connect = false,
              create_slot = false,
              enabled = false,
              slot_name = NONE
            );
        `,
      });
    });

    testIsolated("alter subscription configuration", async ({ db }) => {
      const [{ name: mainDbName }] =
        await db.main`select current_database() as name`;

      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE PUBLICATION sub_alter_pub FOR ALL TABLES;
          CREATE PUBLICATION sub_alter_pub2 FOR ALL TABLES;
          CREATE ROLE sub_owner SUPERUSER;
          CREATE SUBSCRIPTION sub_alter
            CONNECTION 'dbname=${mainDbName}'
            PUBLICATION sub_alter_pub
            WITH (
              connect = false,
              create_slot = false,
              enabled = false,
              slot_name = NONE
            );
        `,
        testSql: `
          ALTER SUBSCRIPTION sub_alter
            CONNECTION 'dbname=postgres application_name=sub_alter';

          ALTER SUBSCRIPTION sub_alter
            SET PUBLICATION sub_alter_pub, sub_alter_pub2 WITH (refresh = false);

          ALTER SUBSCRIPTION sub_alter SET (
            slot_name = 'sub_alter_slot',
            binary = true,
            streaming = ${pgVersion >= 17 ? "'parallel'" : "true"},
            synchronous_commit = 'local',
            disable_on_error = true${
              pgVersion >= 16 ? ", password_required = false" : ""
            }${pgVersion >= 17 ? ", run_as_owner = true" : ""}${
              pgVersion >= 17 ? ", origin = 'none'" : ""
            }
          );

          COMMENT ON SUBSCRIPTION sub_alter IS 'subscription metadata';
          ALTER SUBSCRIPTION sub_alter OWNER TO sub_owner;
        `,
      });
    });

    test("drop subscription", async ({ db }) => {
      const [{ name: mainDbName }] =
        await db.main`select current_database() as name`;

      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE PUBLICATION sub_drop_pub FOR ALL TABLES;
          CREATE SUBSCRIPTION sub_drop
            CONNECTION 'dbname=${mainDbName}'
            PUBLICATION sub_drop_pub
            WITH (
              connect = false,
              create_slot = false,
              enabled = false,
              slot_name = NONE
            );
        `,
        testSql: `DROP SUBSCRIPTION sub_drop;`,
      });
    });
  });
}
