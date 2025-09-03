import { describe, expect, test } from "vitest";
import type { ColumnProps } from "../../base.model.ts";
import { Index } from "../index.model.ts";
import { CreateIndex } from "./index.create.ts";

describe("index", () => {
  test("create minimal", () => {
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

  test("create with all options", () => {
    // Full-options index using an expression, non-btree method, partial predicate,
    // storage params and tablespace
    const indexWithExpr = new Index({
      schema: "public",
      table_name: "test_table",
      name: "test_index_expr",
      storage_params: ["fillfactor=90", "deduplicate_items=off"],
      statistics_target: [0],
      index_type: "hash",
      tablespace: "fast_space",
      is_unique: true,
      is_constraint: false,
      is_primary: false,
      is_exclusion: false,
      nulls_not_distinct: true,
      immediate: true,
      is_clustered: false,
      is_replica_identity: false,
      key_columns: [1],
      column_collations: ["pg_catalog"],
      operator_classes: ["pg_catalog.text_ops"],
      column_options: [1 | 2],
      index_expressions: "lower(col1)",
      partial_predicate: "col1 is not null",
      table_relkind: "r",
    });

    const changeExpr = new CreateIndex({ index: indexWithExpr });

    expect(changeExpr.serialize()).toBe(
      "CREATE UNIQUE INDEX test_index_expr ON public.test_table USING hash(lower(col1)) NULLS NOT DISTINCT WHERE col1 is not null WITH (fillfactor=90, deduplicate_items=off) TABLESPACE fast_space",
    );

    // Also cover column name resolution via indexableObject (mapping)
    const indexWithCols = new Index({
      schema: "public",
      table_name: "test_table",
      name: "test_index_cols",
      storage_params: [],
      statistics_target: [0],
      index_type: "btree",
      tablespace: null,
      is_unique: false,
      is_constraint: false,
      is_primary: false,
      is_exclusion: false,
      nulls_not_distinct: false,
      immediate: true,
      is_clustered: false,
      is_replica_identity: false,
      key_columns: [1, 2, 3],
      column_collations: ["pg_catalog.C", "pg_catalog.C", "pg_catalog.C"],
      operator_classes: [
        "pg_catalog.int4_ops",
        "pg_catalog.timestamptz_ops",
        "pg_catalog.int4_ops",
      ],
      column_options: [0, 3, 1],
      index_expressions: null,
      partial_predicate: null,
      table_relkind: "r",
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
      {
        name: "updated_at",
        position: 2,
        data_type: "timestamp",
        data_type_str: "timestamp",
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
      {
        name: "priority",
        position: 3,
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

    const changeCols = new CreateIndex({
      index: indexWithCols,
      indexableObject: { columns },
    });

    expect(changeCols.serialize()).toBe(
      `CREATE INDEX test_index_cols ON public.test_table (id COLLATE "pg_catalog.C" pg_catalog.int4_ops, updated_at COLLATE "pg_catalog.C" pg_catalog.timestamptz_ops DESC NULLS FIRST, priority COLLATE "pg_catalog.C" pg_catalog.int4_ops DESC NULLS LAST)`,
    );
  });
});
