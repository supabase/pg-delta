import { describe } from "vitest";
import { CreateExtension } from "../../src/objects/extension/changes/extension.create.ts";
import { CreateTable } from "../../src/objects/table/changes/table.create.ts";
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
        // Force CreateTable to be before CreateExtension
        sortChangesCallback: (a, b) => {
          if (a instanceof CreateTable && b instanceof CreateExtension) {
            return -1;
          }
          return 0;
        },
      });
    });
  });
}
