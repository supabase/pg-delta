import { describe, expect, test } from "vitest";
import type { ColumnProps } from "../../base.model.ts";
import { Index } from "../index.model.ts";
import { CreateIndex } from "./index.create.ts";

describe("index", () => {
  test("create", () => {
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
      is_exclusion: false,
      is_constraint: false,
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
      definition: "CREATE INDEX test_index ON public.test_table (id)",
    });

    const columns: ColumnProps[] = [
      {
        name: "id",
        position: 1,
        data_type: "integer",
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
    ];

    const change = new CreateIndex({ index, indexableObject: { columns } });

    expect(change.serialize()).toBe(
      "CREATE INDEX test_index ON public.test_table (id)",
    );
  });
});
