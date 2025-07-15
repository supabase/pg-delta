import { describe, expect } from "vitest";
import { POSTGRES_VERSIONS } from "../../../tests/migra/constants.ts";
import { getTest, pick } from "../../../tests/migra/utils.ts";
import { inspectIndexes } from "./indexes.ts";

describe.concurrent(
  "inspect indexes",
  () => {
    for (const postgresVersion of POSTGRES_VERSIONS) {
      describe(`postgres ${postgresVersion}`, () => {
        const test = getTest(postgresVersion);

        test(`should be able to inspect stable properties of indexes`, async ({
          db,
        }) => {
          // arrange
          const fixture = /* sql */ `
            create table test_indexes (id integer primary key, value text);
            create index test_idx on test_indexes(value);
          `;
          await Promise.all([db.a.unsafe(fixture), db.b.unsafe(fixture)]);
          // act
          const filterResult = pick([
            "public.test_indexes.test_idx",
            "public.test_indexes.test_indexes_pkey",
          ]);
          const [resultA, resultB] = await Promise.all([
            inspectIndexes(db.a).then(filterResult),
            inspectIndexes(db.b).then(filterResult),
          ]);
          // assert
          expect(resultA).toStrictEqual({
            "public.test_indexes.test_idx": {
              column_options: "0",
              immediate: true,
              included_columns: [1],
              index_expressions: null,
              index_type: "btree",
              is_exclusion: false,
              is_primary: false,
              is_unique: false,
              key_columns: "2",
              name: "test_idx",
              nulls_not_distinct: false,
              owner: "supabase_admin",
              partial_predicate: null,
              schema: "public",
              table_name: "test_indexes",
              table_schema: "public",
              dependent_on: [],
              dependents: [],
            },
            "public.test_indexes.test_indexes_pkey": {
              column_options: "0",
              immediate: true,
              included_columns: [],
              index_expressions: null,
              index_type: "btree",
              is_exclusion: false,
              is_primary: true,
              is_unique: true,
              key_columns: "1",
              name: "test_indexes_pkey",
              nulls_not_distinct: false,
              owner: "supabase_admin",
              partial_predicate: null,
              schema: "public",
              table_name: "test_indexes",
              table_schema: "public",
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
