import { describe, expect } from "vitest";
import { POSTGRES_VERSIONS } from "../../../tests/constants.ts";
import { getTest, pick } from "../../../tests/utils.ts";
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
          create type test_enum_type as enum ('happy', 'sad', 'neutral');
          create type test_composite_type as (street text, city text, zip text);
          create domain test_domain_type as text check (value ~ '^\\d{5}(-\\d{4})?$');
          create type test_range_type as range (subtype = float8);
        `;
        await Promise.all([db.a.unsafe(fixture), db.b.unsafe(fixture)]);

        // act
        const filterResult = pick([
          "public.test_enum_type",
          "public.test_composite_type",
          "public.test_domain_type",
          "public.test_range_type",
        ]);
        const [resultA, resultB] = await Promise.all([
          inspectTypes(db.a).then(filterResult),
          inspectTypes(db.b).then(filterResult),
        ]);

        // assert
        expect(resultA).toStrictEqual({
          "public.test_enum_type": {
            schema: "public",
            name: "test_enum_type",
            type_type: "e",
            type_category: "E",
            is_preferred: false,
            is_defined: true,
            delimiter: ",",
            storage_length: 4,
            passed_by_value: true,
            alignment: "i",
            storage: "p",
            not_null: false,
            type_modifier: -1,
            array_dimensions: 0,
            default_bin: null,
            default_value: null,
            owner: "supabase_admin",
            dependent_on: [],
            dependents: [],
          },
          "public.test_composite_type": {
            schema: "public",
            name: "test_composite_type",
            type_type: "c",
            type_category: "C",
            is_preferred: false,
            is_defined: true,
            delimiter: ",",
            storage_length: -1,
            passed_by_value: false,
            alignment: "d",
            storage: "x",
            not_null: false,
            type_modifier: -1,
            array_dimensions: 0,
            default_bin: null,
            default_value: null,
            owner: "supabase_admin",
            dependent_on: [],
            dependents: [],
          },
          "public.test_domain_type": {
            schema: "public",
            name: "test_domain_type",
            type_type: "d",
            type_category: "S",
            is_preferred: false,
            is_defined: true,
            delimiter: ",",
            storage_length: -1,
            passed_by_value: false,
            alignment: "i",
            storage: "x",
            not_null: false,
            type_modifier: -1,
            array_dimensions: 0,
            default_bin: null,
            default_value: null,
            owner: "supabase_admin",
            dependent_on: [],
            dependents: [],
          },
          "public.test_range_type": {
            schema: "public",
            name: "test_range_type",
            type_type: "r",
            type_category: "R",
            is_preferred: false,
            is_defined: true,
            delimiter: ",",
            storage_length: -1,
            passed_by_value: false,
            alignment: "d",
            storage: "x",
            not_null: false,
            type_modifier: -1,
            array_dimensions: 0,
            default_bin: null,
            default_value: null,
            owner: "supabase_admin",
            dependent_on: [],
            dependents: [],
          },
        });
        expect(resultB).toStrictEqual(resultA);
      });
    });
  }
});
