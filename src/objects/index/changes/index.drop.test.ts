import { describe, expect, test } from "vitest";
import { Index } from "../index.model.ts";
import { DropIndex } from "./index.drop.ts";

describe("index", () => {
  test("drop", () => {
    const index = new Index({
      schema: "public",
      table_name: "test_table",
      name: "test_index",
      storage_params: [],
      statistics_target: [0],
      index_type: "btree",
      tablespace: null,
      is_unique: false,
      is_primary: false,
      is_constraint: false,
      is_exclusion: false,
      nulls_not_distinct: false,
      immediate: true,
      is_clustered: false,
      is_replica_identity: false,
      key_columns: [1],
      column_collations: [],
      operator_classes: [],
      column_options: [],
      index_expressions: null,
      partial_predicate: null,
      table_relkind: "r",
    });

    const change = new DropIndex({
      index,
    });

    expect(change.serialize()).toBe("DROP INDEX public.test_index");
  });
});
