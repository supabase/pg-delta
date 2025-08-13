import { describe, expect, test } from "vitest";
import {
  AlterTableChangeOwner,
  AlterTableDisableRowLevelSecurity,
  AlterTableEnableRowLevelSecurity,
  AlterTableForceRowLevelSecurity,
  AlterTableNoForceRowLevelSecurity,
  AlterTableSetLogged,
  AlterTableSetStorageParams,
  AlterTableSetUnlogged,
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
});
