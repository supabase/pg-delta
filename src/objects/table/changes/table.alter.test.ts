import { describe, expect, test } from "vitest";
import type { ColumnProps } from "../../base.model.ts";
import { Table, type TableProps } from "../table.model.ts";
import {
  AlterTableAddColumn,
  AlterTableAddConstraint,
  AlterTableAlterColumnDropDefault,
  AlterTableAlterColumnDropNotNull,
  AlterTableAlterColumnSetDefault,
  AlterTableAlterColumnSetNotNull,
  AlterTableAlterColumnType,
  AlterTableAttachPartition,
  AlterTableChangeOwner,
  AlterTableDetachPartition,
  AlterTableDisableRowLevelSecurity,
  AlterTableDropColumn,
  AlterTableDropConstraint,
  AlterTableEnableRowLevelSecurity,
  AlterTableForceRowLevelSecurity,
  AlterTableNoForceRowLevelSecurity,
  AlterTableResetStorageParams,
  AlterTableSetLogged,
  AlterTableSetReplicaIdentity,
  AlterTableSetStorageParams,
  AlterTableSetUnlogged,
  AlterTableValidateConstraint,
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
        partition_by: null,
        parent_schema: null,
        parent_name: null,
        columns: [],
        privileges: [],
      };
      const table = new Table({
        ...props,
        owner: "old_owner",
      });

      const change = new AlterTableChangeOwner({ table, owner: "new_owner" });

      expect(change.serialize()).toBe(
        "ALTER TABLE public.test_table OWNER TO new_owner",
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
        partition_by: null,
        parent_schema: null,
        parent_name: null,
        columns: [],
        privileges: [],
      };
      const table = new Table({ ...props, owner: "o1", options: null });

      const change = new AlterTableSetUnlogged({ table });
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
        partition_by: null,
        parent_schema: null,
        parent_name: null,
        columns: [],
        privileges: [],
      };
      const table = new Table({ ...props, owner: "o1", options: null });

      const change = new AlterTableSetLogged({ table });
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
        partition_by: null,
        parent_schema: null,
        parent_name: null,
        columns: [],
        privileges: [],
      };
      const enable = new AlterTableEnableRowLevelSecurity({
        table: new Table({
          ...base,
          owner: "o1",
          options: null,
          row_security: false,
        }),
      });
      expect(enable.serialize()).toBe(
        "ALTER TABLE public.test_table ENABLE ROW LEVEL SECURITY",
      );
      const disable = new AlterTableDisableRowLevelSecurity({
        table: new Table({
          ...base,
          owner: "o1",
          options: null,
          row_security: true,
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
          partition_by: null,
          parent_schema: null,
          parent_name: null,
          columns: [],
          privileges: [],
        };
      const force = new AlterTableForceRowLevelSecurity({
        table: new Table({
          ...base,
          owner: "o1",
          options: null,
          force_row_security: false,
        }),
      });
      expect(force.serialize()).toBe(
        "ALTER TABLE public.test_table FORCE ROW LEVEL SECURITY",
      );
      const noforce = new AlterTableNoForceRowLevelSecurity({
        table: new Table({
          ...base,
          owner: "o1",
          options: null,
          force_row_security: true,
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
        partition_by: null,
        parent_schema: null,
        parent_name: null,
        columns: [],
        privileges: [],
      };
      const change = new AlterTableSetStorageParams({
        table: new Table({ ...base, owner: "o1", options: null }),
        options: ["fillfactor=90"],
      });
      expect(change.serialize()).toBe(
        "ALTER TABLE public.test_table SET (fillfactor=90)",
      );
    });

    test("reset storage params", () => {
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
        partition_by: null,
        parent_schema: null,
        parent_name: null,
        columns: [],
        privileges: [],
      };
      const table = new Table({
        ...base,
        owner: "o1",
        options: ["fillfactor=90", "autovacuum_enabled=true"],
      });
      const change = new AlterTableResetStorageParams({
        table,
        params: ["fillfactor", "autovacuum_enabled"],
      });
      expect(change.serialize()).toBe(
        "ALTER TABLE public.test_table RESET (fillfactor, autovacuum_enabled)",
      );
    });

    test("replica identity default/nothing/full", () => {
      const baseProps: Omit<
        TableProps,
        "owner" | "options" | "replica_identity"
      > = {
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
        is_partition: false,
        partition_bound: null,
        partition_by: null,
        parent_schema: null,
        parent_name: null,
        columns: [],
        privileges: [],
      };
      const table = new Table({
        ...baseProps,
        owner: "o1",
        options: null,
        replica_identity: "d",
      });
      const toNothing = new Table({
        ...baseProps,
        owner: "o1",
        options: null,
        replica_identity: "n",
      });
      const toFull = new Table({
        ...baseProps,
        owner: "o1",
        options: null,
        replica_identity: "f",
      });
      expect(
        new AlterTableSetReplicaIdentity({
          table,
          mode: toNothing.replica_identity,
        }).serialize(),
      ).toBe("ALTER TABLE public.test_table REPLICA IDENTITY NOTHING");
      expect(
        new AlterTableSetReplicaIdentity({
          table,
          mode: toFull.replica_identity,
        }).serialize(),
      ).toBe("ALTER TABLE public.test_table REPLICA IDENTITY FULL");
    });

    test("replica identity DEFAULT and INDEX fallback", () => {
      const baseProps: Omit<
        TableProps,
        "owner" | "options" | "replica_identity"
      > = {
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
        is_partition: false,
        partition_bound: null,
        partition_by: null,
        parent_schema: null,
        parent_name: null,
        columns: [],
        privileges: [],
      };
      const table = new Table({
        ...baseProps,
        owner: "o1",
        options: null,
        replica_identity: "n",
      });
      const toDefault = new Table({
        ...baseProps,
        owner: "o1",
        options: null,
        replica_identity: "d",
      });
      const toIndex = new Table({
        ...baseProps,
        owner: "o1",
        options: null,
        replica_identity: "i",
      });
      expect(
        new AlterTableSetReplicaIdentity({
          table,
          mode: toDefault.replica_identity,
        }).serialize(),
      ).toBe("ALTER TABLE public.test_table REPLICA IDENTITY DEFAULT");
      // AlterTableSetReplicaIdentity of type "i" will not be emitted in diff, it is handled by index changes, we fallback to DEFAULT here
      expect(
        new AlterTableSetReplicaIdentity({
          table,
          mode: toIndex.replica_identity,
        }).serialize(),
      ).toBe("ALTER TABLE public.test_table REPLICA IDENTITY DEFAULT");
    });

    test("columns add/drop/alter", () => {
      const tableProps: Omit<TableProps, "owner" | "options"> = {
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
        partition_by: null,
        parent_schema: null,
        parent_name: null,
        columns: [],
        privileges: [],
      };
      const colInt: ColumnProps = {
        name: "a",
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
      };
      const colText: ColumnProps = {
        ...colInt,
        name: "b",
        data_type: "text",
        data_type_str: "text",
      };
      const withCols = new Table({
        ...tableProps,
        owner: "o1",
        options: null,
        columns: [colInt],
      });
      const changeAdd = new AlterTableAddColumn({
        table: withCols,
        column: colInt,
      });
      expect(changeAdd.serialize()).toBe(
        "ALTER TABLE public.test_table ADD COLUMN a integer",
      );

      const dropFrom = new Table({
        ...tableProps,
        owner: "o1",
        options: null,
        columns: [colInt, colText],
      });
      const changeDrop = new AlterTableDropColumn({
        table: dropFrom,
        column: colText,
      });
      expect(changeDrop.serialize()).toBe(
        "ALTER TABLE public.test_table DROP COLUMN b",
      );

      const changeType = new AlterTableAlterColumnType({
        table: withCols,
        column: colText,
      });
      expect(changeType.serialize()).toBe(
        "ALTER TABLE public.test_table ALTER COLUMN b TYPE text",
      );

      const changeSetDefault = new AlterTableAlterColumnSetDefault({
        table: withCols,
        column: { ...colInt, default: "0" },
      });
      expect(changeSetDefault.serialize()).toBe(
        "ALTER TABLE public.test_table ALTER COLUMN a SET DEFAULT 0",
      );

      const changeDropDefault = new AlterTableAlterColumnDropDefault({
        table: withCols,
        column: { ...colInt, default: null },
      });
      expect(changeDropDefault.serialize()).toBe(
        "ALTER TABLE public.test_table ALTER COLUMN a DROP DEFAULT",
      );

      const changeSetNotNull = new AlterTableAlterColumnSetNotNull({
        table: withCols,
        column: { ...colInt, not_null: true },
      });
      expect(changeSetNotNull.serialize()).toBe(
        "ALTER TABLE public.test_table ALTER COLUMN a SET NOT NULL",
      );

      const changeDropNotNull = new AlterTableAlterColumnDropNotNull({
        table: withCols,
        column: { ...colInt, not_null: false },
      });
      expect(changeDropNotNull.serialize()).toBe(
        "ALTER TABLE public.test_table ALTER COLUMN a DROP NOT NULL",
      );
    });

    test("add column with collation, default and not null", () => {
      const tableProps: Omit<TableProps, "owner" | "options"> = {
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
        partition_by: null,
        parent_schema: null,
        parent_name: null,
        columns: [],
        privileges: [],
      };
      const withCols = new Table({ ...tableProps, owner: "o1", options: null });
      const col: ColumnProps = {
        name: "a",
        position: 1,
        data_type: "integer",
        data_type_str: "integer",
        is_custom_type: false,
        custom_type_type: null,
        custom_type_category: null,
        custom_type_schema: null,
        custom_type_name: null,
        not_null: true,
        is_identity: false,
        is_identity_always: false,
        is_generated: false,
        collation: "mycoll",
        default: "0",
        comment: null,
      };
      const change = new AlterTableAddColumn({ table: withCols, column: col });
      expect(change.serialize()).toBe(
        "ALTER TABLE public.test_table ADD COLUMN a integer COLLATE mycoll DEFAULT 0 NOT NULL",
      );
    });

    test("alter column type with collation", () => {
      const tableProps: Omit<TableProps, "owner" | "options"> = {
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
        partition_by: null,
        parent_schema: null,
        parent_name: null,
        columns: [],
        privileges: [],
      };
      const withCols = new Table({ ...tableProps, owner: "o1", options: null });
      const col: ColumnProps = {
        name: "b",
        position: 1,
        data_type: "text",
        data_type_str: "text",
        is_custom_type: false,
        custom_type_type: null,
        custom_type_category: null,
        custom_type_schema: null,
        custom_type_name: null,
        not_null: false,
        is_identity: false,
        is_identity_always: false,
        is_generated: false,
        collation: "mycoll",
        default: null,
        comment: null,
      };
      const change = new AlterTableAlterColumnType({
        table: withCols,
        column: col,
      });
      expect(change.serialize()).toBe(
        "ALTER TABLE public.test_table ALTER COLUMN b TYPE text COLLATE mycoll",
      );
    });

    test("set default NULL fallback", () => {
      const tableProps: Omit<TableProps, "owner" | "options"> = {
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
        partition_by: null,
        parent_schema: null,
        parent_name: null,
        columns: [],
        privileges: [],
      };
      const withCols = new Table({ ...tableProps, owner: "o1", options: null });
      const col: ColumnProps = {
        name: "a",
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
      };
      const change = new AlterTableAlterColumnSetDefault({
        table: withCols,
        column: col,
      });
      expect(change.serialize()).toBe(
        "ALTER TABLE public.test_table ALTER COLUMN a SET DEFAULT NULL",
      );
    });

    test("constraints add/drop/validate and flavors", () => {
      const t = new Table({
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
        partition_by: null,
        owner: "o1",
        parent_schema: null,
        parent_name: null,
        columns: [
          {
            name: "a",
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
        ],
        privileges: [],
      });
      const pkey = {
        name: "pk_t",
        constraint_type: "p" as const,
        deferrable: false,
        initially_deferred: false,
        validated: true,
        is_local: true,
        no_inherit: false,
        key_columns: ["a"],
        foreign_key_columns: null,
        foreign_key_table: null,
        foreign_key_schema: null,
        on_update: null,
        on_delete: null,
        match_type: null,
        check_expression: null,
        owner: "o1",
        definition: "PRIMARY KEY(a)",
      };

      expect(
        new AlterTableAddConstraint({ table: t, constraint: pkey }).serialize(),
      ).toBe(
        "ALTER TABLE public.test_table ADD CONSTRAINT pk_t PRIMARY KEY(a)",
      );

      // drop + validate
      expect(
        new AlterTableDropConstraint({
          table: t,
          constraint: pkey,
        }).serialize(),
      ).toBe("ALTER TABLE public.test_table DROP CONSTRAINT pk_t");
      expect(
        new AlterTableValidateConstraint({
          table: t,
          constraint: pkey,
        }).serialize(),
      ).toBe("ALTER TABLE public.test_table VALIDATE CONSTRAINT pk_t");
    });

    test("attach/detach partition", () => {
      const table = new Table({
        schema: "public",
        name: "events",
        persistence: "p",
        row_security: false,
        force_row_security: false,
        has_indexes: false,
        has_rules: false,
        has_triggers: false,
        has_subclasses: false,
        is_populated: true,
        replica_identity: "d",
        is_partition: false,
        options: null,
        partition_bound: null,
        partition_by: "RANGE (created_at)",
        owner: "o1",
        parent_schema: null,
        parent_name: null,
        columns: [
          {
            name: "created_at",
            position: 1,
            data_type: "timestamp without time zone",
            data_type_str: "timestamp without time zone",
            is_custom_type: false,
            custom_type_type: null,
            custom_type_category: null,
            custom_type_schema: null,
            custom_type_name: null,
            not_null: true,
            is_identity: false,
            is_identity_always: false,
            is_generated: false,
            collation: null,
            default: null,
            comment: null,
          },
        ],
        privileges: [],
      });

      const part2025 = new Table({
        schema: "public",
        name: "events_2025",
        persistence: "p",
        row_security: false,
        force_row_security: false,
        has_indexes: false,
        has_rules: false,
        has_triggers: false,
        has_subclasses: false,
        is_populated: true,
        replica_identity: "d",
        is_partition: true,
        options: null,
        partition_bound:
          "FOR VALUES FROM ('2025-01-01 00:00:00') TO ('2026-01-01 00:00:00')",
        partition_by: null,
        owner: "o1",
        parent_schema: "public",
        parent_name: "events",
        columns: [],
        privileges: [],
      });

      const attach = new AlterTableAttachPartition({
        table,
        partition: part2025,
      });
      expect(attach.serialize()).toBe(
        "ALTER TABLE public.events ATTACH PARTITION public.events_2025 FOR VALUES FROM ('2025-01-01 00:00:00') TO ('2026-01-01 00:00:00')",
      );

      const detach = new AlterTableDetachPartition({
        table,
        partition: part2025,
      });
      expect(detach.serialize()).toBe(
        "ALTER TABLE public.events DETACH PARTITION public.events_2025",
      );
    });
  });
});
