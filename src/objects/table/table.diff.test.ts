import { describe, expect, test } from "vitest";
import { AlterTableChangeOwner, ReplaceTable } from "./changes/table.alter.ts";
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

  test("replace on non-alterable change", () => {
    const main = new Table(base);
    const branch = new Table({ ...base, options: ["autovacuum_enabled=off"] });
    const changes = diffTables(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(ReplaceTable);
  });
});
