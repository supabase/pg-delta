import { describe, expect, test } from "vitest";
import { Index } from "../index.model.ts";
import {
  AlterIndexSetStatistics,
  AlterIndexSetStorageParams,
  AlterIndexSetTablespace,
  ReplaceIndex,
} from "./index.alter.ts";

describe.concurrent("index", () => {
  describe("alter", () => {
    test("set storage params", () => {
      const main = new Index({
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
      });
      const branch = new Index({
        table_schema: "public",
        table_name: "test_table",
        name: "test_index",
        storage_params: ["fillfactor=90"],
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
      });

      const change = new AlterIndexSetStorageParams({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "ALTER INDEX public . test_table . test_index SET (fillfactor=90)",
      );
    });

    test("set statistics", () => {
      const main = new Index({
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
      });
      const branch = new Index({
        table_schema: "public",
        table_name: "test_table",
        name: "test_index",
        storage_params: [],
        statistics_target: [100],
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
      });

      const change = new AlterIndexSetStatistics({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "ALTER INDEX public . test_table . test_index SET STATISTICS 100",
      );
    });

    test("set tablespace", () => {
      const main = new Index({
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
      });
      const branch = new Index({
        table_schema: "public",
        table_name: "test_table",
        name: "test_index",
        storage_params: [],
        statistics_target: [0],
        index_type: "btree",
        tablespace: "fast_space",
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
      });

      const change = new AlterIndexSetTablespace({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "ALTER INDEX public . test_table . test_index SET TABLESPACE fast_space",
      );
    });

    test("replace index", () => {
      const main = new Index({
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
      });
      const branch = new Index({
        table_schema: "public",
        table_name: "test_table",
        name: "test_index",
        storage_params: [],
        statistics_target: [0],
        index_type: "hash",
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
      });

      const change = new ReplaceIndex({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "DROP INDEX public . test_table . test_index;\nCREATE INDEX test_index ON public.test_table USING hash (column1)",
      );
    });
  });
});
