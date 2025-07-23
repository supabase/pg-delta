import { describe, expect } from "vitest";
import { POSTGRES_VERSIONS } from "../../../tests/constants.ts";
import { getTest, pick } from "../../../tests/utils.ts";
import { inspectEnums } from "./enums.ts";

describe.concurrent("inspect enums", () => {
  for (const postgresVersion of POSTGRES_VERSIONS) {
    describe(`postgres ${postgresVersion}`, () => {
      const test = getTest(postgresVersion);

      test(`should be able to inspect stable properties of enums`, async ({
        db,
      }) => {
        // arrange
        const fixture = /* sql */ `
            create type test_enum as enum ('a', 'b', 'c');
          `;
        await Promise.all([db.a.unsafe(fixture), db.b.unsafe(fixture)]);
        // act
        const filterResult = pick(["public.test_enum"]);
        const [resultA, resultB] = await Promise.all([
          inspectEnums(db.a).then(filterResult),
          inspectEnums(db.b).then(filterResult),
        ]);
        // assert
        expect(resultA).toStrictEqual({
          "public.test_enum": {
            schema: "public",
            name: "test_enum",
            owner: "supabase_admin",
            dependent_on: [],
            dependents: [],
            labels: [
              {
                sort_order: 1,
                label: "a",
              },
              {
                sort_order: 2,
                label: "b",
              },
              {
                sort_order: 3,
                label: "c",
              },
            ],
          },
        });
        expect(resultB).toStrictEqual(resultA);
      });
    });
  }
});
