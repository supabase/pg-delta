import { describe, expect } from "vitest";
import { POSTGRES_VERSIONS } from "../../../tests/migra/constants.ts";
import { getTest, pick } from "../../../tests/migra/utils.ts";
import { inspectConstraints } from "./constraints.ts";

describe.concurrent(
  "inspect constraints",
  () => {
    for (const postgresVersion of POSTGRES_VERSIONS) {
      describe(`postgres ${postgresVersion}`, () => {
        const test = getTest(postgresVersion);

        test(`should be able to inspect stable properties of constraints`, async ({
          db,
        }) => {
          // arrange
          const fixture = /* sql */ `
            create table test_constraints (id integer primary key, value text unique);
          `;
          await Promise.all([db.a.unsafe(fixture), db.b.unsafe(fixture)]);
          // act
          const resultA = await inspectConstraints(db.a);
          const resultB = await inspectConstraints(db.b);
          // assert
          const filterResult = pick([
            "public.test_constraints.test_constraints_pkey",
            "public.test_constraints.test_constraints_value_key",
          ]);
          expect(filterResult(resultA)).toStrictEqual({
            "public.test_constraints.test_constraints_pkey": {
              check_expression: null,
              constraint_type: "p",
              deferrable: false,
              foreign_key_columns: null,
              foreign_key_schema: null,
              foreign_key_table: null,
              initially_deferred: false,
              is_local: true,
              key_columns: [1],
              match_type: " ",
              name: "test_constraints_pkey",
              no_inherit: true,
              on_delete: " ",
              on_update: " ",
              owner: "supabase_admin",
              schema: "public",
              table_name: "test_constraints",
              table_schema: "public",
              validated: true,
              dependent_on: [],
              dependents: [],
            },
            "public.test_constraints.test_constraints_value_key": {
              check_expression: null,
              constraint_type: "u",
              deferrable: false,
              foreign_key_columns: null,
              foreign_key_schema: null,
              foreign_key_table: null,
              initially_deferred: false,
              is_local: true,
              key_columns: [2],
              match_type: " ",
              name: "test_constraints_value_key",
              no_inherit: true,
              on_delete: " ",
              on_update: " ",
              owner: "supabase_admin",
              schema: "public",
              table_name: "test_constraints",
              table_schema: "public",
              validated: true,
              dependent_on: [],
              dependents: [],
            },
          });
          expect(filterResult(resultB)).toStrictEqual(filterResult(resultA));
        });
      });
    }
  },
  30_000,
);
