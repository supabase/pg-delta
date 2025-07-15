import { describe, expect } from "vitest";
import { POSTGRES_VERSIONS } from "../../../tests/migra/constants.ts";
import { getTest, pick } from "../../../tests/migra/utils.ts";
import { inspectCollations } from "./collations.ts";

describe.concurrent("inspect collations", () => {
  for (const postgresVersion of POSTGRES_VERSIONS) {
    describe(`postgres ${postgresVersion}`, () => {
      const test = getTest(postgresVersion);

      test(`should be able to inspect stable properties of collations`, async ({
        db,
      }) => {
        // arrange
        const fixture = /* sql */ `
            create collation test_collation (locale = 'C');
          `;
        await Promise.all([db.a.unsafe(fixture), db.b.unsafe(fixture)]);
        // act
        const filterResult = pick(["public.test_collation"]);
        const [resultA, resultB] = await Promise.all([
          inspectCollations(db.a).then(filterResult),
          inspectCollations(db.b).then(filterResult),
        ]);
        // assert
        expect(resultA).toStrictEqual({
          "public.test_collation": {
            collate: "C",
            ctype: "C",
            encoding: 6,
            icu_rules: null,
            is_deterministic: true,
            locale: null,
            name: "test_collation",
            owner: "supabase_admin",
            provider: "c",
            schema: "public",
            version: null,
            dependent_on: [],
            dependents: [],
          },
        });
        expect(resultB).toStrictEqual(resultA);
      });
    });
  }
});
