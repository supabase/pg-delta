/**
 * Integration tests for table-function dependency ordering.
 *
 * These tests specifically verify that the ordering fix works correctly:
 * 1. Functions with RETURNS SETOF need tables to exist first
 * 2. Tables with function-based defaults need functions to exist first (handled by refinement)
 */

import dedent from "dedent";
import { describe } from "vitest";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { getTest } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTest(pgVersion);

  describe.concurrent(`table-function dependency ordering (pg${pgVersion})`, () => {
    test("verify tables created before functions with RETURNS SETOF", async ({
      db,
    }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: dedent`
          CREATE TABLE test_schema.users (
            id bigserial PRIMARY KEY,
            email text UNIQUE
          );

          CREATE FUNCTION test_schema.get_users()
          RETURNS SETOF test_schema.users
          LANGUAGE sql
          STABLE
          AS $function$SELECT * FROM test_schema.users$function$;
        `,
      });
    });

    test("verify function-based defaults work via refinement", async ({
      db,
    }) => {
      // This tests the refinement pass which reorders when table depends on function
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: dedent`
          CREATE FUNCTION test_schema.serial_counter()
          RETURNS integer
          LANGUAGE plpgsql
          VOLATILE
          AS $function$
          BEGIN
            RETURN nextval('test_schema.counter_seq'::regclass);
          END;
          $function$;

          CREATE SEQUENCE test_schema.counter_seq;

          CREATE TABLE test_schema.event_log (
            id integer PRIMARY KEY DEFAULT test_schema.serial_counter(),
            message text
          );
        `,
      });
    });
  });
}
