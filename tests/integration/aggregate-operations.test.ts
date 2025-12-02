/**
 * Integration tests for PostgreSQL aggregate operations.
 */

import dedent from "dedent";
import { describe } from "vitest";
import type { Change } from "../../src/core/change.types.ts";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { getTest, getTestIsolated } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTest(pgVersion);
  const testIsolated = getTestIsolated(pgVersion);

  describe.concurrent(`aggregate operations (pg${pgVersion})`, () => {
    test("aggregate creation", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: dedent`
          CREATE AGGREGATE test_schema.collect_text(text)
          (
            SFUNC = pg_catalog.array_append,
            STYPE = text[],
            INITCOND = '{}'
          );
        `,
      });
    });

    testIsolated("aggregate owner change", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: dedent`
          CREATE SCHEMA test_schema;
          CREATE AGGREGATE test_schema.collect_text(text)
          (
            SFUNC = array_append,
            STYPE = text[],
            INITCOND = '{}'
          );
          CREATE ROLE aggregate_owner;
        `,
        testSql: dedent`
          ALTER AGGREGATE test_schema.collect_text(text) OWNER TO aggregate_owner;
        `,
      });
    });

    test("aggregate drop", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: dedent`
          CREATE SCHEMA test_schema;
          CREATE AGGREGATE test_schema.collect_text(text)
          (
            SFUNC = array_append,
            STYPE = text[],
            INITCOND = '{}'
          );
        `,
        testSql: dedent`
          DROP AGGREGATE test_schema.collect_text(text);
        `,
      });
    });

    test("aggregate comment creation", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: dedent`
          CREATE SCHEMA test_schema;
          CREATE AGGREGATE test_schema.collect_text_comment(text)
          (
            SFUNC = pg_catalog.array_append,
            STYPE = text[],
            INITCOND = '{}'
          );
        `,
        testSql: dedent`
          COMMENT ON AGGREGATE test_schema.collect_text_comment(text) IS 'aggregate comment';
        `,
      });
    });

    test("aggregate comment removal", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: dedent`
          CREATE SCHEMA test_schema;
          CREATE AGGREGATE test_schema.collect_text_comment_drop(text)
          (
            SFUNC = pg_catalog.array_append,
            STYPE = text[],
            INITCOND = '{}'
          );
          COMMENT ON AGGREGATE test_schema.collect_text_comment_drop(text) IS 'aggregate comment';
        `,
        testSql: dedent`
          COMMENT ON AGGREGATE test_schema.collect_text_comment_drop(text) IS NULL;
        `,
      });
    });

    testIsolated(
      "aggregate comment creation depends on aggregate create order",
      async ({ db }) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA test_schema;",
          testSql: dedent`
            CREATE AGGREGATE test_schema.collect_text_dependency(text)
            (
              SFUNC = pg_catalog.array_append,
              STYPE = text[],
              INITCOND = '{}'
            );

            COMMENT ON AGGREGATE test_schema.collect_text_dependency(text) IS 'dependency check';
          `,
          sortChangesCallback: (a, b) => {
            // force comment create ahead of aggregate create to ensure dependency sorting fixes the order
            const priority = (change: Change) => {
              if (
                change.objectType === "aggregate" &&
                change.scope === "comment" &&
                change.operation === "create"
              ) {
                return 0;
              }
              if (
                change.objectType === "aggregate" &&
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
      },
    );

    testIsolated("aggregate grant privileges", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: dedent`
          CREATE SCHEMA test_schema;
          CREATE AGGREGATE test_schema.collect_text_priv(text)
          (
            SFUNC = pg_catalog.array_append,
            STYPE = text[],
            INITCOND = '{}'
          );
          CREATE ROLE aggregate_executor;
        `,
        testSql: dedent`
          GRANT EXECUTE ON FUNCTION test_schema.collect_text_priv(text) TO aggregate_executor;
        `,
      });
    });

    testIsolated("aggregate revoke privileges", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: dedent`
          CREATE SCHEMA test_schema;
          CREATE AGGREGATE test_schema.collect_text_priv_revoke(text)
          (
            SFUNC = pg_catalog.array_append,
            STYPE = text[],
            INITCOND = '{}'
          );
          CREATE ROLE aggregate_executor;
          GRANT EXECUTE ON FUNCTION test_schema.collect_text_priv_revoke(text) TO aggregate_executor;
        `,
        testSql: dedent`
          REVOKE EXECUTE ON FUNCTION test_schema.collect_text_priv_revoke(text) FROM aggregate_executor;
        `,
      });
    });
  });
}
