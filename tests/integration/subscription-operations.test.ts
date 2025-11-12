import dedent from "dedent";
import { describe } from "vitest";
import type { Change } from "../../src/change.types.ts";
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

    test("subscription comment creation", async ({ db }) => {
      const [{ name: mainDbName }] =
        await db.main`select current_database() as name`;

      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: dedent`
          CREATE PUBLICATION sub_comment_pub FOR ALL TABLES;
          CREATE SUBSCRIPTION sub_comment
            CONNECTION 'dbname=${mainDbName}'
            PUBLICATION sub_comment_pub
            WITH (
              connect = false,
              create_slot = false,
              enabled = false,
              slot_name = NONE
            );
        `,
        testSql: `COMMENT ON SUBSCRIPTION sub_comment IS 'subscription comment';`,
      });
    });

    test("subscription comment removal", async ({ db }) => {
      const [{ name: mainDbName }] =
        await db.main`select current_database() as name`;

      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: dedent`
          CREATE PUBLICATION sub_comment_drop_pub FOR ALL TABLES;
          CREATE SUBSCRIPTION sub_comment_drop
            CONNECTION 'dbname=${mainDbName}'
            PUBLICATION sub_comment_drop_pub
            WITH (
              connect = false,
              create_slot = false,
              enabled = false,
              slot_name = NONE
            );
          COMMENT ON SUBSCRIPTION sub_comment_drop IS 'subscription comment';
        `,
        testSql: `COMMENT ON SUBSCRIPTION sub_comment_drop IS NULL;`,
      });
    });

    test("subscription comment creation depends on subscription create order", async ({
      db,
    }) => {
      const [{ name: mainDbName }] =
        await db.main`select current_database() as name`;

      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: dedent`
            CREATE PUBLICATION sub_comment_dependency_pub FOR ALL TABLES;
          `,
        testSql: dedent`
            CREATE SUBSCRIPTION sub_comment_dependency
              CONNECTION 'dbname=${mainDbName}'
              PUBLICATION sub_comment_dependency_pub
              WITH (
                connect = false,
                create_slot = false,
                enabled = false,
                slot_name = NONE
              );

            COMMENT ON SUBSCRIPTION sub_comment_dependency IS 'dependency check';
          `,
        sortChangesCallback: (a: Change, b: Change) => {
          // Force the comment create to sort ahead of the subscription create to prove the sorter fixes the order.
          const priority = (change: Change) => {
            if (
              change.objectType === "subscription" &&
              change.scope === "comment" &&
              change.operation === "create"
            ) {
              return 0;
            }
            if (
              change.objectType === "subscription" &&
              change.scope === "object" &&
              change.operation === "create"
            ) {
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
