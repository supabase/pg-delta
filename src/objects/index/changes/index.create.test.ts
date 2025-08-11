import { describe, expect, test } from "vitest";
import { Index } from "../index.model.ts";
import { CreateIndex } from "./index.create.ts";

describe("index", () => {
  test("create", () => {
    const index = new Index({
      table_schema: "public",
      table_name: "test_table",
      name: "test_index",
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
      key_columns: [1],
      column_collations: [],
      operator_classes: [],
      column_options: [],
      index_expressions: null,
      partial_predicate: null,
      table_relkind: "r",
    });

    const change = new CreateIndex({
      index,
    });

    expect(change.serialize()).toBe(
      "CREATE INDEX test_index ON public.test_table (column1)",
    );
  });
});
