import { describe, expect, test } from "vitest";
import { Table, type TableProps } from "../table.model.ts";
import {
  AlterTableChangeOwner,
  AlterTableDisableRowLevelSecurity,
  AlterTableEnableRowLevelSecurity,
  AlterTableForceRowLevelSecurity,
  AlterTableNoForceRowLevelSecurity,
  AlterTableSetLogged,
  AlterTableSetStorageParams,
  AlterTableSetUnlogged,
  ReplaceTable,
} from "./table.alter.ts";

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
        columns: [],
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

    test("replace table when switching to temporary", () => {
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
        columns: [],
      };
      const main = new Table({
        ...props,
        persistence: "p",
      });
      const branch = new Table({
        ...props,
        persistence: "t",
      });

      const change = new ReplaceTable({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "DROP TABLE public.test_table;\nCREATE TEMPORARY TABLE public.test_table ()",
      );
    });

    test("set unlogged", () => {
      const props: Omit<TableProps, "owner" | "options"> = {
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
        partition_bound: null,
        parent_schema: null,
        parent_name: null,
        columns: [],
      };
      const main = new Table({ ...props, owner: "o1", options: null });
      const branch = new Table({
        ...props,
        owner: "o1",
        options: null,
        persistence: "u",
      });

      const change = new AlterTableSetUnlogged({ main, branch });
      expect(change.serialize()).toBe(
        "ALTER TABLE public.test_table SET UNLOGGED",
      );
    });

    test("set logged", () => {
      const props: Omit<TableProps, "owner" | "options"> = {
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
        partition_bound: null,
        parent_schema: null,
        parent_name: null,
        columns: [],
      };
      const main = new Table({ ...props, owner: "o1", options: null });
      const branch = new Table({
        ...props,
        owner: "o1",
        options: null,
        persistence: "p",
      });

      const change = new AlterTableSetLogged({ main, branch });
      expect(change.serialize()).toBe(
        "ALTER TABLE public.test_table SET LOGGED",
      );
    });

    test("enable/disable row level security", () => {
      const base: Omit<TableProps, "owner" | "options" | "row_security"> = {
        schema: "public",
        name: "test_table",
        persistence: "p",
        force_row_security: false,
        has_indexes: false,
        has_rules: false,
        has_triggers: false,
        has_subclasses: false,
        is_populated: false,
        replica_identity: "d",
        is_partition: false,
        partition_bound: null,
        parent_schema: null,
        parent_name: null,
        columns: [],
      };
      const enable = new AlterTableEnableRowLevelSecurity({
        main: new Table({
          ...base,
          owner: "o1",
          options: null,
          row_security: false,
        }),
        branch: new Table({
          ...base,
          owner: "o1",
          options: null,
          row_security: true,
        }),
      });
      expect(enable.serialize()).toBe(
        "ALTER TABLE public.test_table ENABLE ROW LEVEL SECURITY",
      );
      const disable = new AlterTableDisableRowLevelSecurity({
        main: new Table({
          ...base,
          owner: "o1",
          options: null,
          row_security: true,
        }),
        branch: new Table({
          ...base,
          owner: "o1",
          options: null,
          row_security: false,
        }),
      });
      expect(disable.serialize()).toBe(
        "ALTER TABLE public.test_table DISABLE ROW LEVEL SECURITY",
      );
    });

    test("force/no force row level security", () => {
      const base: Omit<TableProps, "owner" | "options" | "force_row_security"> =
        {
          schema: "public",
          name: "test_table",
          persistence: "p",
          row_security: true,
          has_indexes: false,
          has_rules: false,
          has_triggers: false,
          has_subclasses: false,
          is_populated: false,
          replica_identity: "d",
          is_partition: false,
          partition_bound: null,
          parent_schema: null,
          parent_name: null,
          columns: [],
        };
      const force = new AlterTableForceRowLevelSecurity({
        main: new Table({
          ...base,
          owner: "o1",
          options: null,
          force_row_security: false,
        }),
        branch: new Table({
          ...base,
          owner: "o1",
          options: null,
          force_row_security: true,
        }),
      });
      expect(force.serialize()).toBe(
        "ALTER TABLE public.test_table FORCE ROW LEVEL SECURITY",
      );
      const noforce = new AlterTableNoForceRowLevelSecurity({
        main: new Table({
          ...base,
          owner: "o1",
          options: null,
          force_row_security: true,
        }),
        branch: new Table({
          ...base,
          owner: "o1",
          options: null,
          force_row_security: false,
        }),
      });
      expect(noforce.serialize()).toBe(
        "ALTER TABLE public.test_table NO FORCE ROW LEVEL SECURITY",
      );
    });

    test("set storage params", () => {
      const base: Omit<TableProps, "owner" | "options"> = {
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
        partition_bound: null,
        parent_schema: null,
        parent_name: null,
        columns: [],
      };
      const change = new AlterTableSetStorageParams({
        main: new Table({ ...base, owner: "o1", options: null }),
        branch: new Table({ ...base, owner: "o1", options: ["fillfactor=90"] }),
      });
      expect(change.serialize()).toBe(
        "ALTER TABLE public.test_table SET (fillfactor=90)",
      );
    });
  });
});
