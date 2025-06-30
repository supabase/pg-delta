import { describe, expect } from "vitest";
import { POSTGRES_VERSIONS } from "../../../tests/migra/constants.ts";
import { getTest } from "../../../tests/migra/utils.ts";
import { inspectEnums } from "./enums.ts";

describe.concurrent(
  "inspect enums",
  () => {
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
          const resultA = await inspectEnums(db.a);
          const resultB = await inspectEnums(db.b);
          // assert
          expect(resultA).toMatchInlineSnapshot(`
            Map {
              "public.test_enum" => [
                {
                  "label": "a",
                  "name": "test_enum",
                  "owner": "test",
                  "schema": "public",
                  "sort_order": 1,
                },
                {
                  "label": "b",
                  "name": "test_enum",
                  "owner": "test",
                  "schema": "public",
                  "sort_order": 2,
                },
                {
                  "label": "c",
                  "name": "test_enum",
                  "owner": "test",
                  "schema": "public",
                  "sort_order": 3,
                },
              ],
            }
          `);
          expect(resultB).toEqual(resultA);
        });
      });
    }
  },
  30_000,
);
