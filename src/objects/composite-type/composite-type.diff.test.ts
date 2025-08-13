import { describe, expect, test } from "vitest";
import {
  AlterCompositeTypeChangeOwner,
  ReplaceCompositeType,
} from "./changes/composite-type.alter.ts";
import { CreateCompositeType } from "./changes/composite-type.create.ts";
import { DropCompositeType } from "./changes/composite-type.drop.ts";
import { diffCompositeTypes } from "./composite-type.diff.ts";
import {
  CompositeType,
  type CompositeTypeProps,
} from "./composite-type.model.ts";

const base: CompositeTypeProps = {
  schema: "public",
  name: "ct",
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
  columns: [],
};

describe.concurrent("composite-type.diff", () => {
  test("create and drop", () => {
    const ct = new CompositeType(base);
    const created = diffCompositeTypes({}, { [ct.stableId]: ct });
    expect(created[0]).toBeInstanceOf(CreateCompositeType);
    const dropped = diffCompositeTypes({ [ct.stableId]: ct }, {});
    expect(dropped[0]).toBeInstanceOf(DropCompositeType);
  });

  test("alter owner", () => {
    const main = new CompositeType(base);
    const branch = new CompositeType({ ...base, owner: "o2" });
    const changes = diffCompositeTypes(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(AlterCompositeTypeChangeOwner);
  });

  test("replace on non-alterable change", () => {
    const main = new CompositeType(base);
    const branch = new CompositeType({ ...base, options: ["fillfactor=90"] });
    const changes = diffCompositeTypes(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(ReplaceCompositeType);
  });
});
