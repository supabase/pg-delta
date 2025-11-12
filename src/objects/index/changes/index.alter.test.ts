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
        is_owned_by_constraint: false,
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
        owner: "test",
      };
      const index = new Index({
        ...props,
        storage_params: [],
      });

      const change = new AlterIndexSetStorageParams({
        index,
        paramsToSet: ["fillfactor=90"],
        keysToReset: [],
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
        is_owned_by_constraint: false,
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
        owner: "test",
      };
      const index = new Index({
        ...props,
        storage_params: ["fillfactor=70", "fastupdate=on"],
      });

      const change = new AlterIndexSetStorageParams({
        index,
        paramsToSet: ["fillfactor=90"],
        keysToReset: ["fastupdate"],
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
        is_owned_by_constraint: false,
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
        owner: "test",
      };
      const index = new Index({
        ...props,
        statistics_target: [0],
      });

      const change = new AlterIndexSetStatistics({
        index,
        columnTargets: [{ columnNumber: 1, statistics: 100 }],
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
        is_owned_by_constraint: false,
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
        owner: "test",
      };
      const index = new Index({
        ...props,
        tablespace: null,
      });

      const change = new AlterIndexSetTablespace({
        index,
        tablespace: "fast_space",
      });

      expect(change.serialize()).toBe(
        "ALTER INDEX public.test_index SET TABLESPACE fast_space",
      );
    });
  });
});
