import { describe, expect } from "vitest";
import { POSTGRES_VERSIONS } from "../../../tests/constants.ts";
import { getTest, pick } from "../../../tests/utils.ts";
import { inspectFunctions } from "./functions.ts";

describe.concurrent("inspect functions", () => {
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
        const filterResult = pick([
          "public.test_function(a integer, b integer)",
        ]);
        const [resultA, resultB] = await Promise.all([
          inspectFunctions(db.a).then(filterResult),
          inspectFunctions(db.b).then(filterResult),
        ]);
        // assert
        expect(resultA).toStrictEqual({
          "public.test_function(a integer, b integer)": {
            all_argument_types: ["integer", "integer", "integer", "integer"],
            argument_count: 2,
            argument_default_count: 0,
            argument_defaults: null,
            argument_modes: ["i", "i", "t", "t"],
            argument_names: ["a", "b", "sum", "product"],
            argument_types: ["integer", "integer"],
            binary_path: null,
            config: null,
            is_strict: false,
            kind: "f",
            language: "plpgsql",
            leakproof: false,
            name: "test_function",
            owner: "supabase_admin",
            parallel_safety: "u",
            return_type: "record",
            return_type_schema: "pg_catalog",
            returns_set: true,
            schema: "public",
            security_definer: false,
            source_code:
              "\n" +
              "            begin\n" +
              "              return query select a + b, a * b;\n" +
              "            end;\n" +
              "            ",
            sql_body: null,
            volatility: "v",
            dependent_on: [],
            dependents: [],
          },
        });
        expect(resultB).toStrictEqual(resultA);
      });
    });
  }
});
