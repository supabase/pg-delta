import { describe, expect, test } from "vitest";
import { Table, type TableProps } from "../table.model.ts";
import { DropTable } from "./table.drop.ts";

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

describe.concurrent("table.drop", () => {
  test("drop table basic", () => {
    const t = new Table(base);
    const change = new DropTable({ table: t });
    expect(change.serialize()).toBe("DROP TABLE public.t");
  });
});
