import { describe, expect } from "vitest";
import { POSTGRES_VERSIONS } from "../../../tests/constants.ts";
import { getTest } from "../../../tests/utils.ts";
import { inspectLanguages } from "./languages.ts";

describe.concurrent(
  "inspect languages",
  () => {
    for (const postgresVersion of POSTGRES_VERSIONS) {
      describe(`postgres ${postgresVersion}`, () => {
        const test = getTest(postgresVersion);

        test(`should detect all languages`, async ({ db }) => {
          // Initial state should only have sql language per default
          const resultA = await inspectLanguages(db.a);
          const resultB = await inspectLanguages(db.b);

          expect(resultA).toStrictEqual(
            new Map([
              [
                "sql",
                {
                  name: "sql",
                  is_trusted: true,
                  is_procedural: false,
                  call_handler: null,
                  inline_handler: null,
                  validator: "fmgr_sql_validator(oid)",
                  owner: "supabase_admin",
                  dependent_on: [],
                  dependents: [],
                },
              ],
              [
                "plpgsql",
                {
                  name: "plpgsql",
                  is_trusted: true,
                  is_procedural: true,
                  call_handler: "plpgsql_call_handler()",
                  inline_handler: "plpgsql_inline_handler(internal)",
                  validator: "plpgsql_validator(oid)",
                  owner: "supabase_admin",
                  dependent_on: [],
                  dependents: [],
                },
              ],
            ]),
          );
          expect(resultB).toEqual(resultA);
        });
        test(`should detect language removal`, async ({ db }) => {
          // arrange
          const fixture = /* sql */ `
            drop extension "plpgsql" cascade;
          `;
          await Promise.all([db.a.unsafe(fixture), db.b.unsafe(fixture)]);
          // Initial state should only have sql language per default
          const resultA = await inspectLanguages(db.a);
          const resultB = await inspectLanguages(db.b);

          expect(resultA.get("plpgsql")).toStrictEqual(undefined);
          expect(resultB).toEqual(resultA);
        });
      });
    }
  },
  30_000,
);
