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
  AlterTableResetStorageParams,
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
  partition_by: null,
  owner: "o1",
  parent_schema: null,
  parent_name: null,
  columns: [],
};

describe.concurrent("table.diff", () => {
  test("create and drop", () => {
    const t = new Table(base);
    const created = diffTables({}, { [t.stableId]: t }, 150014);
    expect(created[0]).toBeInstanceOf(CreateTable);
    const dropped = diffTables({ [t.stableId]: t }, {}, 150014);
    expect(dropped[0]).toBeInstanceOf(DropTable);
  });

  test("created NOT VALID CHECK emits AddConstraint + ValidateConstraint", () => {
    const main = new Table({
      ...base,
      name: "t_nv",
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
      constraints: [],
    });
    const branch = new Table({
      ...main,
      constraints: [
        {
          name: "ck_nv",
          constraint_type: "c" as const,
          deferrable: false,
          initially_deferred: false,
          validated: false,
          is_local: true,
          no_inherit: false,
          key_columns: [],
          foreign_key_columns: null,
          foreign_key_table: null,
          foreign_key_schema: null,
          on_update: null,
          on_delete: null,
          match_type: null,
          check_expression: "a > 0",
          owner: "o1",
          definition: "CHECK (a > 0)",
        },
      ],
    });
    const changes = diffTables(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
      150014,
    );
    expect(changes.some((c) => c instanceof AlterTableAddConstraint)).toBe(
      true,
    );
    expect(changes.some((c) => c instanceof AlterTableValidateConstraint)).toBe(
      true,
    );
  });

  test("alter owner", () => {
    const main = new Table(base);
    const branch = new Table({ ...base, owner: "o2" });
    const changes = diffTables(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
      150014,
    );
    expect(changes[0]).toBeInstanceOf(AlterTableChangeOwner);
  });

  test("options change uses ALTER TABLE SET (...) instead of replace", () => {
    const main = new Table(base);
    const branch = new Table({ ...base, options: ["fillfactor=90"] });
    const changes = diffTables(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
      150014,
    );
    expect(changes[0]).toBeInstanceOf(AlterTableSetStorageParams);
  });

  test("option removed emits RESET", () => {
    const main = new Table({
      ...base,
      options: ["fillfactor=90", "autovacuum_enabled=true"],
    });
    const branch = new Table({
      ...base,
      options: ["autovacuum_enabled=true"],
    });
    const changes = diffTables(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
      150014,
    );
    expect(changes.some((c) => c instanceof AlterTableSetStorageParams)).toBe(
      true,
    );
    expect(changes.some((c) => c instanceof AlterTableResetStorageParams)).toBe(
      true,
    );
  });

  test("persistence p->u uses ALTER TABLE SET UNLOGGED", () => {
    const main = new Table(base);
    const branch = new Table({ ...base, persistence: "u" });
    const changes = diffTables(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
      150014,
    );
    expect(changes.some((c) => c instanceof AlterTableSetUnlogged)).toBe(true);
  });

  test("persistence u->p uses ALTER TABLE SET LOGGED", () => {
    const main = new Table({ ...base, persistence: "u" });
    const branch = new Table({ ...base, persistence: "p" });
    const changes = diffTables(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
      150014,
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
      150014,
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
      150014,
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
      150014,
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
      150014,
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
      150014,
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
      definition: "PRIMARY KEY (a)",
    };
    const created = diffTables(
      { [t1.stableId]: t1 },
      {
        [t1.stableId]: new Table({ ...base, name: "t1", constraints: [pkey] }),
      },
      150014,
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
      150014,
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
      150014,
    );
    expect(altered.some((c) => c instanceof AlterTableDropConstraint)).toBe(
      true,
    );
    expect(altered.some((c) => c instanceof AlterTableAddConstraint)).toBe(
      true,
    );
  });

  test("altered primary key columns triggers drop+add", () => {
    const tMain = new Table({
      ...base,
      name: "t_cols",
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
        {
          name: "b",
          position: 2,
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
      constraints: [
        {
          name: "pk_cols",
          constraint_type: "p",
          deferrable: false,
          initially_deferred: false,
          validated: true,
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
          definition: "PRIMARY KEY (a)",
        },
      ],
    });
    const tBranch = new Table({
      ...tMain,
      constraints: [
        {
          ...tMain.constraints[0],
          key_columns: [1, 2],
        },
      ],
    });
    const changes = diffTables(
      { [tMain.stableId]: tMain },
      { [tBranch.stableId]: tBranch },
      150014,
    );
    expect(changes.some((c) => c instanceof AlterTableDropConstraint)).toBe(
      true,
    );
    expect(changes.some((c) => c instanceof AlterTableAddConstraint)).toBe(
      true,
    );
  });

  test("altered foreign key properties triggers drop+add and validate when not validated", () => {
    const tMain = new Table({
      ...base,
      name: "t_fk",
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
      constraints: [
        {
          name: "fk_a",
          constraint_type: "f",
          deferrable: false,
          initially_deferred: false,
          validated: true,
          is_local: true,
          no_inherit: false,
          key_columns: [1],
          foreign_key_columns: [1],
          foreign_key_table: "other",
          foreign_key_schema: "public",
          on_update: "a",
          on_delete: "a",
          match_type: "u",
          check_expression: null,
          owner: "o1",
          definition: "FOREIGN KEY (a) REFERENCES other(a)",
        },
      ],
    });
    const tBranch = new Table({
      ...tMain,
      constraints: [
        {
          ...(tMain.constraints[0] as (typeof tMain.constraints)[number]),
          on_delete: "c",
          validated: false,
        },
      ],
    });
    const changes = diffTables(
      { [tMain.stableId]: tMain },
      {
        [tBranch.stableId]: tBranch,
        "table:public.other": new Table({
          ...base,
          name: "other",
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
        }),
      },
      150014,
    );
    expect(changes.some((c) => c instanceof AlterTableDropConstraint)).toBe(
      true,
    );
    expect(changes.some((c) => c instanceof AlterTableAddConstraint)).toBe(
      true,
    );
    expect(changes.some((c) => c instanceof AlterTableValidateConstraint)).toBe(
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
      150014,
    );
    expect(added.some((c) => c instanceof AlterTableAddColumn)).toBe(true);

    const dropped = diffTables(
      { [withCol.stableId]: withCol },
      { [main.stableId]: main },
      150014,
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
      150014,
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
      150014,
    );
    expect(
      defaultAddedChanges.some(
        (c) => c instanceof AlterTableAlterColumnSetDefault,
      ),
    ).toBe(true);

    const defaultDropped = diffTables(
      { [defaultAdded.stableId]: defaultAdded },
      { [withCol.stableId]: withCol },
      150014,
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
      150014,
    );
    expect(
      notNullSetChanges.some(
        (c) => c instanceof AlterTableAlterColumnSetNotNull,
      ),
    ).toBe(true);

    const notNullDropped = diffTables(
      { [notNullSet.stableId]: notNullSet },
      { [withCol.stableId]: withCol },
      150014,
    );
    expect(
      notNullDropped.some((c) => c instanceof AlterTableAlterColumnDropNotNull),
    ).toBe(true);
  });
});
