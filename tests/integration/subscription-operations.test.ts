import { describe } from "vitest";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { getTest, getTestIsolated } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTest(pgVersion);
  const testIsolated = getTestIsolated(pgVersion);

  describe.concurrent(`subscription operations (pg${pgVersion})`, () => {
    test.only("create subscription without connecting", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        testSql: `
          CREATE SUBSCRIPTION sub_create
            CONNECTION 'dbname=postgres'
            PUBLICATION sub_create_pub
            WITH (connect = false, create_slot = false, enabled = false);
        `,
      });
    });

    testIsolated("alter subscription configuration", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE ROLE sub_owner;
          CREATE SUBSCRIPTION sub_alter
            CONNECTION 'dbname=postgres'
            PUBLICATION sub_alter_pub
            WITH (connect = false, create_slot = false, enabled = false);
        `,
        testSql: `
          ALTER SUBSCRIPTION sub_alter
            CONNECTION 'dbname=postgres application_name=sub_alter';

          ALTER SUBSCRIPTION sub_alter
            SET PUBLICATION sub_alter_pub, sub_alter_pub2 WITH (refresh = false);

          ALTER SUBSCRIPTION sub_alter SET (
            slot_name = 'sub_alter_slot',
            binary = true,
            streaming = 'parallel',
            synchronous_commit = 'local',
            disable_on_error = true,
            password_required = false,
            run_as_owner = true,
            origin = 'none',
            failover = true
          );

          COMMENT ON SUBSCRIPTION sub_alter IS 'subscription metadata';
          ALTER SUBSCRIPTION sub_alter OWNER TO sub_owner;
        `,
      });
    });

    test("drop subscription", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SUBSCRIPTION sub_drop
            CONNECTION 'dbname=postgres'
            PUBLICATION sub_drop_pub
            WITH (connect = false, create_slot = false, enabled = false);
        `,
        testSql: `DROP SUBSCRIPTION sub_drop;`,
      });
    });
  });
}
