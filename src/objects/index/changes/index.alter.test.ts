import { describe, expect, test } from "vitest";
import { Index, type IndexProps } from "../index.model.ts";
import {
  AlterIndexSetStatistics,
  AlterIndexSetStorageParams,
  AlterIndexSetTablespace,
} from "./index.alter.ts";

describe.concurrent("index", () => {
  describe("alter", () => {
    test("set storage params", () => {
      const props: Omit<IndexProps, "storage_params"> = {
        schema: "public",
        table_name: "test_table",
        name: "test_index",
        statistics_target: [0],
        index_type: "btree",
        tablespace: null,
        is_constraint: false,
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
        definition:
          "CREATE INDEX test_index ON public.test_table USING btree (id)",
        comment: null,
      };
      const main = new Index({
        ...props,
        storage_params: [],
      });
      const branch = new Index({
        ...props,
        storage_params: ["fillfactor=90"],
      });

      const change = new AlterIndexSetStorageParams({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "ALTER INDEX public.test_index SET (fillfactor=90)",
      );
    });

    test("reset and set storage params", () => {
      const props: Omit<IndexProps, "storage_params"> = {
        schema: "public",
        table_name: "test_table",
        name: "test_index",
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
        definition:
          "CREATE INDEX test_index ON public.test_table USING btree (id)",
        comment: null,
      };
      const main = new Index({
        ...props,
        storage_params: ["fillfactor=70", "fastupdate=on"],
      });
      const branch = new Index({
        ...props,
        storage_params: ["fillfactor=90"],
      });

      const change = new AlterIndexSetStorageParams({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        [
          "ALTER INDEX public.test_index RESET (fastupdate)",
          "ALTER INDEX public.test_index SET (fillfactor=90)",
        ].join(";\n"),
      );
    });

    test("set statistics", () => {
      const props: Omit<IndexProps, "statistics_target"> = {
        schema: "public",
        table_name: "test_table",
        name: "test_index",
        storage_params: [],
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
        definition:
          "CREATE INDEX test_index ON public.test_table USING btree (id)",
        comment: null,
      };
      const main = new Index({
        ...props,
        statistics_target: [0],
      });
      const branch = new Index({
        ...props,
        statistics_target: [100],
      });

      const change = new AlterIndexSetStatistics({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "ALTER INDEX public.test_index ALTER COLUMN 1 SET STATISTICS 100",
      );
    });

    test("set tablespace", () => {
      const props: Omit<IndexProps, "tablespace"> = {
        schema: "public",
        table_name: "test_table",
        name: "test_index",
        storage_params: [],
        statistics_target: [0],
        index_type: "btree",
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
        definition:
          "CREATE INDEX test_index ON public.test_table USING btree (id)",
        comment: null,
      };
      const main = new Index({
        ...props,
        tablespace: null,
      });
      const branch = new Index({
        ...props,
        tablespace: "fast_space",
      });

      const change = new AlterIndexSetTablespace({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "ALTER INDEX public.test_index SET TABLESPACE fast_space",
      );
    });
  });
});
