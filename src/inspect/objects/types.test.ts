import { describe, expect } from "vitest";
import { POSTGRES_VERSIONS } from "../../../tests/migra/constants.ts";
import { getTest, pick } from "../../../tests/migra/utils.ts";
import { inspectTypes } from "./types.ts";

describe.concurrent("inspect types", () => {
  for (const postgresVersion of POSTGRES_VERSIONS) {
    describe(`postgres ${postgresVersion}`, () => {
      const test = getTest(postgresVersion);

      test(`should be able to inspect stable properties of types`, async ({
        db,
      }) => {
        // arrange
        const fixture = /* sql */ `
            create type test_type as (a integer, b text);
          `;
        await Promise.all([db.a.unsafe(fixture), db.b.unsafe(fixture)]);
        // act
        const filterResult = pick(["public._test_type", "public.test_type"]);
        const [resultA, resultB] = await Promise.all([
          inspectTypes(db.a).then(filterResult),
          inspectTypes(db.b).then(filterResult),
        ]);
        // assert
        expect(resultA).toStrictEqual({
          "public._test_type": {
            alignment: "d",
            array_dimensions: 0,
            default_bin: null,
            default_value: null,
            delimiter: ",",
            is_defined: true,
            is_preferred: false,
            name: "_test_type",
            not_null: false,
            owner: "supabase_admin",
            passed_by_value: false,
            schema: "public",
            storage: "x",
            storage_length: -1,
            type_category: "A",
            type_modifier: -1,
            type_type: "b",
          },
          "public.test_type": {
            alignment: "d",
            array_dimensions: 0,
            default_bin: null,
            default_value: null,
            delimiter: ",",
            is_defined: true,
            is_preferred: false,
            name: "test_type",
            not_null: false,
            owner: "supabase_admin",
            passed_by_value: false,
            schema: "public",
            storage: "x",
            storage_length: -1,
            type_category: "C",
            type_modifier: -1,
            type_type: "c",
          },
        });
        expect(resultB).toStrictEqual(resultA);
      });
    });
  }
});
