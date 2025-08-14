import { describe, expect, test } from "vitest";
import {
  AlterTableAddColumn,
  AlterTableAddConstraint,
  AlterTableAlterColumnDropDefault,
  AlterTableAlterColumnDropNotNull,
  AlterTableAlterColumnSetDefault,
  AlterTableAlterColumnSetNotNull,
  AlterTableAlterColumnType,
  AlterTableChangeOwner,
  AlterTableDisableRowLevelSecurity,
  AlterTableDropColumn,
  AlterTableDropConstraint,
  AlterTableEnableRowLevelSecurity,
  AlterTableForceRowLevelSecurity,
  AlterTableNoForceRowLevelSecurity,
  AlterTableSetLogged,
  AlterTableSetReplicaIdentity,
  AlterTableSetStorageParams,
  AlterTableSetUnlogged,
  AlterTableValidateConstraint,
} from "./changes/table.alter.ts";
import { CreateTable } from "./changes/table.create.ts";
import { DropTable } from "./changes/table.drop.ts";
import { diffTables } from "./table.diff.ts";
import { Table, type TableProps } from "./table.model.ts";

const base: TableProps = {
  schema: "public",
  name: "t",
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
  owner: "o1",
  parent_schema: null,
  parent_name: null,
  columns: [],
};

describe.concurrent("table.diff", () => {
  test("create and drop", () => {
    const t = new Table(base);
    const created = diffTables({}, { [t.stableId]: t });
    expect(created[0]).toBeInstanceOf(CreateTable);
    const dropped = diffTables({ [t.stableId]: t }, {});
    expect(dropped[0]).toBeInstanceOf(DropTable);
  });

  test("alter owner", () => {
    const main = new Table(base);
    const branch = new Table({ ...base, owner: "o2" });
    const changes = diffTables(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(AlterTableChangeOwner);
  });

  test("options change uses ALTER TABLE SET (...) instead of replace", () => {
    const main = new Table(base);
    const branch = new Table({ ...base, options: ["fillfactor=90"] });
    const changes = diffTables(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(AlterTableSetStorageParams);
  });

  test("persistence p->u uses ALTER TABLE SET UNLOGGED", () => {
    const main = new Table(base);
    const branch = new Table({ ...base, persistence: "u" });
    const changes = diffTables(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes.some((c) => c instanceof AlterTableSetUnlogged)).toBe(true);
  });

  test("persistence u->p uses ALTER TABLE SET LOGGED", () => {
    const main = new Table({ ...base, persistence: "u" });
    const branch = new Table({ ...base, persistence: "p" });
    const changes = diffTables(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes.some((c) => c instanceof AlterTableSetLogged)).toBe(true);
  });

  test("row level security toggles", () => {
    const enable = diffTables(
      {
        "table:public.t1": new Table({
          ...base,
          name: "t1",
          row_security: false,
        }),
      },
      {
        "table:public.t1": new Table({
          ...base,
          name: "t1",
          row_security: true,
        }),
      },
    );
    expect(
      enable.some((c) => c instanceof AlterTableEnableRowLevelSecurity),
    ).toBe(true);
    const disable = diffTables(
      {
        "table:public.t2": new Table({
          ...base,
          name: "t2",
          row_security: true,
        }),
      },
      {
        "table:public.t2": new Table({
          ...base,
          name: "t2",
          row_security: false,
        }),
      },
    );
    expect(
      disable.some((c) => c instanceof AlterTableDisableRowLevelSecurity),
    ).toBe(true);
  });

  test("force row level security toggles", () => {
    const force = diffTables(
      {
        "table:public.t3": new Table({
          ...base,
          name: "t3",
          row_security: true,
          force_row_security: false,
        }),
      },
      {
        "table:public.t3": new Table({
          ...base,
          name: "t3",
          row_security: true,
          force_row_security: true,
        }),
      },
    );
    expect(
      force.some((c) => c instanceof AlterTableForceRowLevelSecurity),
    ).toBe(true);

    const noforce = diffTables(
      {
        "table:public.t4": new Table({
          ...base,
          name: "t4",
          row_security: true,
          force_row_security: true,
        }),
      },
      {
        "table:public.t4": new Table({
          ...base,
          name: "t4",
          row_security: true,
          force_row_security: false,
        }),
      },
    );
    expect(
      noforce.some((c) => c instanceof AlterTableNoForceRowLevelSecurity),
    ).toBe(true);
  });

  test("replica identity diff emits REPLICA IDENTITY", () => {
    const main = new Table(base);
    const branch = new Table({ ...base, replica_identity: "n" });
    const changes = diffTables(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes.some((c) => c instanceof AlterTableSetReplicaIdentity)).toBe(
      true,
    );
  });

  test("constraints create/drop/alter and validate", () => {
    const t1 = new Table({ ...base, name: "t1", constraints: [] });
    const pkey = {
      name: "pk_t1",
      constraint_type: "p" as const,
      deferrable: false,
      initially_deferred: false,
      validated: false,
      is_local: true,
      no_inherit: false,
      key_columns: [1],
      foreign_key_columns: null,
      foreign_key_table: null,
      foreign_key_schema: null,
      on_update: null,
      on_delete: null,
      match_type: null,
      check_expression: null,
      owner: "o1",
    };
    const created = diffTables(
      { [t1.stableId]: t1 },
      {
        [t1.stableId]: new Table({ ...base, name: "t1", constraints: [pkey] }),
      },
    );
    expect(created.some((c) => c instanceof AlterTableAddConstraint)).toBe(
      true,
    );
    expect(created.some((c) => c instanceof AlterTableValidateConstraint)).toBe(
      true,
    );

    const dropped = diffTables(
      {
        [t1.stableId]: new Table({ ...base, name: "t1", constraints: [pkey] }),
      },
      { [t1.stableId]: t1 },
    );
    expect(dropped.some((c) => c instanceof AlterTableDropConstraint)).toBe(
      true,
    );

    const altered = diffTables(
      {
        [t1.stableId]: new Table({ ...base, name: "t1", constraints: [pkey] }),
      },
      {
        [t1.stableId]: new Table({
          ...base,
          name: "t1",
          constraints: [
            {
              ...pkey,
              deferrable: true,
              initially_deferred: true,
              validated: true,
            },
          ],
        }),
      },
    );
    expect(altered.some((c) => c instanceof AlterTableDropConstraint)).toBe(
      true,
    );
    expect(altered.some((c) => c instanceof AlterTableAddConstraint)).toBe(
      true,
    );
  });

  test("columns added/dropped/altered (type, default, not null)", () => {
    const main = new Table({ ...base, name: "t2", columns: [] });
    const withCol = new Table({
      ...base,
      name: "t2",
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
    });
    const added = diffTables(
      { [main.stableId]: main },
      { [withCol.stableId]: withCol },
    );
    expect(added.some((c) => c instanceof AlterTableAddColumn)).toBe(true);

    const dropped = diffTables(
      { [withCol.stableId]: withCol },
      { [main.stableId]: main },
    );
    expect(dropped.some((c) => c instanceof AlterTableDropColumn)).toBe(true);

    const typeChanged = new Table({
      ...base,
      name: "t2",
      columns: [
        {
          ...withCol.columns[0],
          data_type: "text",
          data_type_str: "text",
        },
      ],
    });
    const typeChanges = diffTables(
      { [withCol.stableId]: withCol },
      { [typeChanged.stableId]: typeChanged },
    );
    expect(
      typeChanges.some((c) => c instanceof AlterTableAlterColumnType),
    ).toBe(true);

    const defaultAdded = new Table({
      ...base,
      name: "t2",
      columns: [{ ...withCol.columns[0], default: "0" }],
    });
    const defaultAddedChanges = diffTables(
      { [withCol.stableId]: withCol },
      { [defaultAdded.stableId]: defaultAdded },
    );
    expect(
      defaultAddedChanges.some(
        (c) => c instanceof AlterTableAlterColumnSetDefault,
      ),
    ).toBe(true);

    const defaultDropped = diffTables(
      { [defaultAdded.stableId]: defaultAdded },
      { [withCol.stableId]: withCol },
    );
    expect(
      defaultDropped.some((c) => c instanceof AlterTableAlterColumnDropDefault),
    ).toBe(true);

    const notNullSet = new Table({
      ...base,
      name: "t2",
      columns: [{ ...withCol.columns[0], not_null: true }],
    });
    const notNullSetChanges = diffTables(
      { [withCol.stableId]: withCol },
      { [notNullSet.stableId]: notNullSet },
    );
    expect(
      notNullSetChanges.some(
        (c) => c instanceof AlterTableAlterColumnSetNotNull,
      ),
    ).toBe(true);

    const notNullDropped = diffTables(
      { [notNullSet.stableId]: notNullSet },
      { [withCol.stableId]: withCol },
    );
    expect(
      notNullDropped.some((c) => c instanceof AlterTableAlterColumnDropNotNull),
    ).toBe(true);
  });
});
