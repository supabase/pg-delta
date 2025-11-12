import { describe } from "vitest";
import type { Change } from "../../src/change.types.ts";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { getTestWithSupabaseIsolated } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTestWithSupabaseIsolated(pgVersion);

  describe.concurrent(`extension operations (pg${pgVersion})`, () => {
    test("create extension", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        testSql: `
          CREATE EXTENSION vector WITH SCHEMA extensions;
          CREATE TABLE test_table (vec extensions.vector);
        `,
        sortChangesCallback: (a, b) => {
          const priority = (change: Change) => {
            if (
              change.objectType === "extension" &&
              change.operation === "create" &&
              change.scope === "object"
            ) {
              return 0;
            }
            if (
              change.objectType === "table" &&
              change.operation === "create"
            ) {
              return 1;
            }
            if (
              change.objectType === "extension" &&
              change.operation === "create" &&
              change.scope === "comment"
            ) {
              return 2;
            }
            return 3;
          };
          return priority(a) - priority(b);
        },
      });
    });
  });
}
