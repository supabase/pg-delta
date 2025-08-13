import { describe, expect, test } from "vitest";
import { AlterViewChangeOwner, ReplaceView } from "./changes/view.alter.ts";
import { CreateView } from "./changes/view.create.ts";
import { DropView } from "./changes/view.drop.ts";
import { diffViews } from "./view.diff.ts";
import { View, type ViewProps } from "./view.model.ts";

const base: ViewProps = {
  schema: "public",
  name: "v",
  definition: "select 1",
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
};

describe.concurrent("view.diff", () => {
  test("create and drop", () => {
    const v = new View(base);
    const created = diffViews({}, { [v.stableId]: v });
    expect(created[0]).toBeInstanceOf(CreateView);
    const dropped = diffViews({ [v.stableId]: v }, {});
    expect(dropped[0]).toBeInstanceOf(DropView);
  });

  test("alter owner", () => {
    const main = new View(base);
    const branch = new View({ ...base, owner: "o2" });
    const changes = diffViews(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(AlterViewChangeOwner);
  });

  test("replace on non-alterable change", () => {
    const main = new View(base);
    const branch = new View({ ...base, definition: "select 2" });
    const changes = diffViews(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(ReplaceView);
  });
});
