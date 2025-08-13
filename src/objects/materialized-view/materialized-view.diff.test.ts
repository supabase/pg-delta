import { describe, expect, test } from "vitest";
import {
  AlterMaterializedViewChangeOwner,
  ReplaceMaterializedView,
} from "./changes/materialized-view.alter.ts";
import { CreateMaterializedView } from "./changes/materialized-view.create.ts";
import { DropMaterializedView } from "./changes/materialized-view.drop.ts";
import { diffMaterializedViews } from "./materialized-view.diff.ts";
import {
  MaterializedView,
  type MaterializedViewProps,
} from "./materialized-view.model.ts";

const base: MaterializedViewProps = {
  schema: "public",
  name: "mv1",
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
  columns: [],
};

describe.concurrent("materialized-view.diff", () => {
  test("create and drop", () => {
    const mv = new MaterializedView(base);
    const created = diffMaterializedViews({}, { [mv.stableId]: mv });
    expect(created[0]).toBeInstanceOf(CreateMaterializedView);
    const dropped = diffMaterializedViews({ [mv.stableId]: mv }, {});
    expect(dropped[0]).toBeInstanceOf(DropMaterializedView);
  });

  test("alter owner", () => {
    const main = new MaterializedView(base);
    const branch = new MaterializedView({ ...base, owner: "o2" });
    const changes = diffMaterializedViews(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(AlterMaterializedViewChangeOwner);
  });

  test("replace on non-alterable change", () => {
    const main = new MaterializedView(base);
    const branch = new MaterializedView({ ...base, definition: "select 2" });
    const changes = diffMaterializedViews(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(ReplaceMaterializedView);
  });
});
