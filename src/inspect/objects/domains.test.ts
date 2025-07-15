import { describe, expect } from "vitest";
import { POSTGRES_VERSIONS } from "../../../tests/migra/constants.ts";
import { getTest, pick } from "../../../tests/migra/utils.ts";
import { inspectDomains } from "./domains.ts";

describe.concurrent(
  "inspect domains",
  () => {
    for (const postgresVersion of POSTGRES_VERSIONS) {
      describe(`postgres ${postgresVersion}`, () => {
        const test = getTest(postgresVersion);

        test(`should be able to inspect stable properties of domains`, async ({
          db,
        }) => {
          // arrange
          const fixture = /* sql */ `
            create domain test_domain as integer not null;
          `;
          await Promise.all([db.a.unsafe(fixture), db.b.unsafe(fixture)]);
          // act
          const filterResult = pick(["public.test_domain"]);
          const [resultA, resultB] = await Promise.all([
            inspectDomains(db.a).then(filterResult),
            inspectDomains(db.b).then(filterResult),
          ]);
          // assert
          expect(resultA).toStrictEqual({
            "public.test_domain": {
              array_dimensions: 0,
              base_type: "int4",
              base_type_schema: "pg_catalog",
              collation: null,
              default_bin: null,
              default_value: null,
              name: "test_domain",
              not_null: true,
              owner: "supabase_admin",
              schema: "public",
              type_modifier: -1,
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
