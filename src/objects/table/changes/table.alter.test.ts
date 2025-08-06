import { describe, expect, test } from "vitest";
import { Table } from "../table.model.ts";
import { AlterTableChangeOwner, ReplaceTable } from "./table.alter.ts";

describe.concurrent("table", () => {
  describe("alter", () => {
    test("change owner", () => {
      const main = new Table({
        schema: "public",
        name: "test_table",
        persistence: "p",
        row_security: false,
        force_row_security: false,
        has_indexes: false,
        has_rules: false,
        has_triggers: false,
        has_subclasses: false,
        is_populated: false,
        replica_identity: "d",
        is_partition: false,
        options: null,
        partition_bound: null,
        owner: "old_owner",
        parent_schema: null,
        parent_name: null,
      });
      const branch = new Table({
        schema: "public",
        name: "test_table",
        persistence: "p",
        row_security: false,
        force_row_security: false,
        has_indexes: false,
        has_rules: false,
        has_triggers: false,
        has_subclasses: false,
        is_populated: false,
        replica_identity: "d",
        is_partition: false,
        options: null,
        partition_bound: null,
        owner: "new_owner",
        parent_schema: null,
        parent_name: null,
      });

      const change = new AlterTableChangeOwner({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "ALTER TABLE public.test_table OWNER TO new_owner",
      );
    });

    test("replace table", () => {
      const main = new Table({
        schema: "public",
        name: "test_table",
        persistence: "p",
        row_security: false,
        force_row_security: false,
        has_indexes: false,
        has_rules: false,
        has_triggers: false,
        has_subclasses: false,
        is_populated: false,
        replica_identity: "d",
        is_partition: false,
        options: null,
        partition_bound: null,
        owner: "test",
        parent_schema: null,
        parent_name: null,
      });
      const branch = new Table({
        schema: "public",
        name: "test_table",
        persistence: "u",
        row_security: false,
        force_row_security: false,
        has_indexes: false,
        has_rules: false,
        has_triggers: false,
        has_subclasses: false,
        is_populated: false,
        replica_identity: "d",
        is_partition: false,
        options: null,
        partition_bound: null,
        owner: "test",
        parent_schema: null,
        parent_name: null,
      });

      const change = new ReplaceTable({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "DROP TABLE public.test_table;\nCREATE UNLOGGED TABLE public.test_table ()",
      );
    });
  });
});
