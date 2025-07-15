import { describe, expect } from "vitest";
import { POSTGRES_VERSIONS } from "../../../tests/migra/constants.ts";
import { getTest, pick } from "../../../tests/migra/utils.ts";
import { inspectExtensions } from "./extensions.ts";

describe.concurrent(
  "inspect extensions",
  () => {
    for (const postgresVersion of POSTGRES_VERSIONS) {
      describe(`postgres ${postgresVersion}`, () => {
        const test = getTest(postgresVersion);

        test(`should be able to inspect stable properties of extensions`, async ({
          db,
        }) => {
          // arrange
          const fixture = /* sql */ `
            create extension citext;
          `;
          await Promise.all([db.a.unsafe(fixture), db.b.unsafe(fixture)]);
          // act
          const filterResult = pick(["pg_catalog.plpgsql", "public.citext"]);
          const [resultA, resultB] = await Promise.all([
            inspectExtensions(db.a).then(filterResult),
            inspectExtensions(db.b).then(filterResult),
          ]);
          // assert
          expect(resultA).toStrictEqual({
            "pg_catalog.plpgsql": {
              name: "plpgsql",
              owner: "supabase_admin",
              relocatable: false,
              schema: "pg_catalog",
              version: "1.0",
              dependent_on: [],
              dependents: [],
            },
            "public.citext": {
              name: "citext",
              owner: "supabase_admin",
              relocatable: true,
              schema: "public",
              version: "1.6",
              dependent_on: [],
              dependents: [],
            },
          });
          expect(resultB).toStrictEqual(resultA);
        });
      });
    }
  },
  30_000,
);
