import { describe, expect, test } from "vitest";
import { Constraint } from "../constraint.model.ts";
import { DropConstraint } from "./constraint.drop.ts";

describe("constraint", () => {
  test("drop", () => {
    const constraint = new Constraint({
      schema: "public",
      name: "test_constraint",
      table_schema: "public",
      table_name: "test_table",
      constraint_type: "c",
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
      check_expression: "value > 0",
      owner: "test",
    });

    const change = new DropConstraint({
      constraint,
    });

    expect(change.serialize()).toBe(
      "ALTER TABLE public . test_table DROP CONSTRAINT test_constraint",
    );
  });
});
