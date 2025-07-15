import { describe, expect } from "vitest";
import { POSTGRES_VERSIONS } from "../../../tests/migra/constants.ts";
import { getTest } from "../../../tests/migra/utils.ts";
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
          const resultA = await inspectIndexes(db.a);
          const resultB = await inspectIndexes(db.b);
          // assert
          expect(resultA).toEqual(
            new Map([
              [
                "public.test_indexes.test_idx",
                {
                  column_collations: [['"default"']],
                  column_options: "0",
                  immediate: true,
                  index_expressions: null,
                  index_type: "btree",
                  is_clustered: false,
                  is_exclusion: false,
                  is_primary: false,
                  is_replica_identity: false,
                  is_unique: false,
                  key_columns: "2",
                  name: "test_idx",
                  nulls_not_distinct: false,
                  operator_classes: ["pg_catalog.text_ops"],
                  partial_predicate: null,
                  storage_params: [],
                  table_name: "test_indexes",
                  table_schema: "public",
                  tablespace: null,
                  dependent_on: [],
                  dependents: [],
                },
              ],
              [
                "public.test_indexes.test_indexes_pkey",
                {
                  column_collations: [["-"]],
                  column_options: "0",
                  immediate: true,
                  index_expressions: null,
                  index_type: "btree",
                  is_clustered: false,
                  is_exclusion: false,
                  is_primary: true,
                  is_replica_identity: false,
                  is_unique: true,
                  key_columns: "1",
                  name: "test_indexes_pkey",
                  nulls_not_distinct: false,
                  operator_classes: ["pg_catalog.int4_ops"],
                  partial_predicate: null,
                  storage_params: [],
                  table_name: "test_indexes",
                  table_schema: "public",
                  tablespace: null,
                  dependent_on: [],
                  dependents: [],
                },
              ],
            ]),
          );
          expect(resultB).toEqual(resultA);
        });
      });
    }
  },
  30_000,
);
