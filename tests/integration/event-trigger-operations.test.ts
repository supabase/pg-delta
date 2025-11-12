/**
 * Integration tests for PostgreSQL event trigger operations.
 */

import dedent from "dedent";
import { describe } from "vitest";
import type { Change } from "../../src/change.types.ts";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { getTest, getTestIsolated } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTest(pgVersion);
  const testIsolated = getTestIsolated(pgVersion);

  describe.concurrent(`event trigger operations (pg${pgVersion})`, () => {
    test("create event trigger with tag filter", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: dedent(`
          CREATE SCHEMA test_schema;
          CREATE FUNCTION test_schema.log_ddl()
          RETURNS event_trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            RAISE NOTICE 'DDL event %', TG_TAG;
          END;
          $$;
        `),
        testSql: dedent(`
          CREATE EVENT TRIGGER ddl_logger
            ON ddl_command_start
            WHEN TAG IN ('CREATE TABLE', 'ALTER TABLE')
            EXECUTE FUNCTION test_schema.log_ddl();
        `),
      });
    });

    test("alter event trigger enabled state", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: dedent(`
          CREATE SCHEMA test_schema;
          CREATE FUNCTION test_schema.log_ddl()
          RETURNS event_trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            RAISE NOTICE 'DDL event %', TG_TAG;
          END;
          $$;
          CREATE EVENT TRIGGER ddl_logger
            ON ddl_command_start
            EXECUTE FUNCTION test_schema.log_ddl();
        `),
        testSql: "ALTER EVENT TRIGGER ddl_logger DISABLE;",
      });
    });

    testIsolated("alter event trigger owner and comment", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: dedent(`
          CREATE ROLE ddl_owner LOGIN SUPERUSER;
          CREATE SCHEMA test_schema;
          CREATE FUNCTION test_schema.log_ddl()
          RETURNS event_trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            RAISE NOTICE 'DDL event %', TG_TAG;
          END;
          $$;
          CREATE EVENT TRIGGER ddl_logger
            ON ddl_command_start
            EXECUTE FUNCTION test_schema.log_ddl();
        `),
        testSql: dedent(`
          ALTER EVENT TRIGGER ddl_logger OWNER TO ddl_owner;
          COMMENT ON EVENT TRIGGER ddl_logger IS 'Logs DDL statements';
        `),
      });
    });

    test("drop event trigger", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: dedent(`
          CREATE SCHEMA test_schema;
          CREATE FUNCTION test_schema.log_ddl()
          RETURNS event_trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            RAISE NOTICE 'DDL event %', TG_TAG;
          END;
          $$;
          CREATE EVENT TRIGGER ddl_logger
            ON ddl_command_start
            EXECUTE FUNCTION test_schema.log_ddl();
        `),
        testSql: "DROP EVENT TRIGGER ddl_logger;",
      });
    });

    test("event trigger comment removal", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: dedent(`
          CREATE SCHEMA test_schema;
          CREATE FUNCTION test_schema.log_ddl()
          RETURNS event_trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            RAISE NOTICE 'DDL event %', TG_TAG;
          END;
          $$;
          CREATE EVENT TRIGGER ddl_logger
            ON ddl_command_start
            EXECUTE FUNCTION test_schema.log_ddl();
          COMMENT ON EVENT TRIGGER ddl_logger IS 'Logs DDL statements';
        `),
        testSql: "COMMENT ON EVENT TRIGGER ddl_logger IS NULL;",
      });
    });

    test("event trigger creation depends on function order", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: dedent(`
            CREATE FUNCTION test_schema.log_ddl_dependency()
            RETURNS event_trigger
            LANGUAGE plpgsql
            AS $$
            BEGIN
              RAISE NOTICE 'dependency %', TG_TAG;
            END;
            $$;

            CREATE EVENT TRIGGER ddl_logger_dependency
              ON ddl_command_start
              EXECUTE FUNCTION test_schema.log_ddl_dependency();
          `),
        sortChangesCallback: (a, b) => {
          // Force event trigger creation ahead of its supporting function to verify dependency sorting
          const priority = (change: Change) => {
            if (
              change.objectType === "event_trigger" &&
              change.scope === "object" &&
              change.operation === "create"
            ) {
              return 0;
            }
            if (
              change.objectType === "procedure" &&
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
