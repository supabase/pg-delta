import { describe, expect, test } from "vitest";
import {
  AlterIndexSetStatistics,
  AlterIndexSetStorageParams,
  AlterIndexSetTablespace,
  ReplaceIndex,
} from "./changes/index.alter.ts";
import { CreateIndex } from "./changes/index.create.ts";
import { DropIndex } from "./changes/index.drop.ts";
import { diffIndexes } from "./index.diff.ts";
import { Index, type IndexProps } from "./index.model.ts";

const base: IndexProps = {
  table_schema: "public",
  table_name: "t",
  name: "ix",
  storage_params: [],
  statistics_target: [0],
  index_type: "btree",
  tablespace: null,
  is_unique: false,
  is_primary: false,
  is_exclusion: false,
  nulls_not_distinct: false,
  immediate: true,
  is_clustered: false,
  is_replica_identity: false,
  key_columns: [],
  column_collations: [],
  operator_classes: [],
  column_options: [],
  index_expressions: "expression",
  partial_predicate: null,
  table_relkind: "r",
};

describe.concurrent("index.diff", () => {
  test("create and drop", () => {
    const idx = new Index(base);
    const created = diffIndexes({}, { [idx.stableId]: idx }, {});
    expect(created[0]).toBeInstanceOf(CreateIndex);
    const dropped = diffIndexes({ [idx.stableId]: idx }, {}, {});
    expect(dropped[0]).toBeInstanceOf(DropIndex);
  });

  test("alter storage params, statistics and tablespace", () => {
    const main = new Index(base);
    const branch = new Index({
      ...base,
      storage_params: ["fillfactor=90"],
      statistics_target: [100],
      tablespace: "ts",
    });
    const changes = diffIndexes(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
      {},
    );
    expect(changes.some((c) => c instanceof AlterIndexSetStorageParams)).toBe(
      true,
    );
    expect(changes.some((c) => c instanceof AlterIndexSetStatistics)).toBe(
      true,
    );
    expect(changes.some((c) => c instanceof AlterIndexSetTablespace)).toBe(
      true,
    );
  });

  test("replace on non-alterable change", () => {
    const main = new Index(base);
    const branch = new Index({ ...base, index_type: "hash" });
    const changes = diffIndexes(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
      {},
    );
    expect(changes[0]).toBeInstanceOf(ReplaceIndex);
  });

  test("create index with key columns and no index_expressions should fail if no indexableObject is provided", () => {
    const main = new Index(base);
    const branch = new Index({
      ...base,
      key_columns: [1],
      index_expressions: null,
    });
    expect(() =>
      diffIndexes({ [main.stableId]: main }, { [branch.stableId]: branch }, {}),
    ).toThrowError(
      "Index requires an indexableObject with columns when key_columns are used",
    );
  });
  test("create index with key columns and valid indexableObject should work", () => {
    const main = new Index(base);
    const branch = new Index({
      ...base,
      key_columns: [1],
      index_expressions: null,
    });
    const changes = diffIndexes(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
      {
        [branch.tableStableId]: {
          columns: [
            {
              name: "a",
              position: 1,
              data_type: "int",
              data_type_str: "integer",
              is_custom_type: false,
              custom_type_type: null,
              custom_type_category: null,
              custom_type_schema: null,
              custom_type_name: null,
              not_null: false,
              is_identity: false,
              is_identity_always: false,
              is_generated: false,
              collation: null,
              default: null,
              comment: null,
            },
          ],
        },
      },
    );
    expect(changes[0]).toBeInstanceOf(ReplaceIndex);
  });
});
