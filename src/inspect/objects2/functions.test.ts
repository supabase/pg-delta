import { describe, expect } from "vitest";
import { POSTGRES_VERSIONS } from "../../../tests/migra/constants.ts";
import { getTest } from "../../../tests/migra/utils.ts";
import { inspectFunctions } from "./functions.ts";

describe.concurrent(
  "inspect functions",
  () => {
    for (const postgresVersion of POSTGRES_VERSIONS) {
      describe(`postgres ${postgresVersion}`, () => {
        const test = getTest(postgresVersion);

        test(`should be able to inspect stable properties of functions`, async ({
          db,
        }) => {
          // arrange
          const fixture = /* sql */ `
            create function test_function(a integer, b integer)
            returns table(sum integer, product integer) as $$
            begin
              return query select a + b, a * b;
            end;
            $$ language plpgsql;
          `;
          await Promise.all([db.a.unsafe(fixture), db.b.unsafe(fixture)]);
          // act
          const resultA = await inspectFunctions(db.a);
          const resultB = await inspectFunctions(db.b);
          // assert
          expect(resultA).toMatchInlineSnapshot(`
            Map {
              "public.test_function(a integer, b integer)" => {
                "all_argument_types": [
                  "integer",
                  "integer",
                  "integer",
                  "integer",
                ],
                "argument_count": 2,
                "argument_default_count": 0,
                "argument_defaults": null,
                "argument_modes": [
                  "i",
                  "i",
                  "t",
                  "t",
                ],
                "argument_names": [
                  "a",
                  "b",
                  "sum",
                  "product",
                ],
                "argument_types": [
                  "integer",
                  "integer",
                ],
                "binary_path": null,
                "config": null,
                "is_strict": false,
                "kind": "f",
                "language": "plpgsql",
                "leakproof": false,
                "name": "test_function",
                "owner": "test",
                "parallel_safety": "u",
                "return_type": "record",
                "return_type_schema": "pg_catalog",
                "returns_set": true,
                "schema": "public",
                "security_definer": false,
                "source_code": "
                        begin
                          return query select a + b, a * b;
                        end;
                        ",
                "sql_body": null,
                "volatility": "v",
              },
            }
          `);
          expect(resultB).toEqual(resultA);
        });
      });
    }
  },
  30_000,
);
