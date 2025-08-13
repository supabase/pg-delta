import { describe, expect, test } from "vitest";
import { ReplaceConstraint } from "./changes/constraint.alter.ts";
import { CreateConstraint } from "./changes/constraint.create.ts";
import { DropConstraint } from "./changes/constraint.drop.ts";
import { diffConstraints } from "./constraint.diff.ts";
import { Constraint, type ConstraintProps } from "./constraint.model.ts";

const base: ConstraintProps = {
  schema: "public",
  name: "c_pk",
  table_schema: "public",
  table_name: "t",
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
};

describe.concurrent("constraint.diff", () => {
  test("create and drop", () => {
    const c = new Constraint(base);
    const created = diffConstraints({}, { [c.stableId]: c });
    expect(created[0]).toBeInstanceOf(CreateConstraint);

    const dropped = diffConstraints({ [c.stableId]: c }, {});
    expect(dropped[0]).toBeInstanceOf(DropConstraint);
  });

  test("replace on property change", () => {
    const main = new Constraint(base);
    const branch = new Constraint({ ...base, deferrable: true });
    const changes = diffConstraints(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(ReplaceConstraint);
  });
});
