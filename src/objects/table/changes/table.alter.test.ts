import { describe, expect, test } from "vitest";
import { Table, type TableProps } from "../table.model.ts";
import { AlterTableChangeOwner, ReplaceTable } from "./table.alter.ts";

describe.concurrent("table", () => {
  describe("alter", () => {
    test("change owner", () => {
      const props: Omit<TableProps, "owner"> = {
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
        parent_schema: null,
        parent_name: null,
      };
      const main = new Table({
        ...props,
        owner: "old_owner",
      });
      const branch = new Table({
        ...props,
        owner: "new_owner",
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
      const props: Omit<TableProps, "persistence"> = {
        schema: "public",
        name: "test_table",
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
      };
      const main = new Table({
        ...props,
        persistence: "p",
      });
      const branch = new Table({
        ...props,
        persistence: "u",
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
