import { describe, expect, test } from "vitest";
import { Constraint, type ConstraintProps } from "../constraint.model.ts";
import { ReplaceConstraint } from "./constraint.alter.ts";

describe.concurrent("constraint", () => {
  describe("alter", () => {
    test("replace constraint", () => {
      const props: Omit<ConstraintProps, "deferrable" | "initially_deferred"> =
        {
          schema: "public",
          name: "test_constraint",
          table_schema: "public",
          table_name: "test_table",
          constraint_type: "c",
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
        };
      const main = new Constraint({
        ...props,
        deferrable: false,
        initially_deferred: false,
      });
      const branch = new Constraint({
        ...props,
        deferrable: true,
        initially_deferred: true,
      });

      const change = new ReplaceConstraint({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "ALTER TABLE public . test_table DROP CONSTRAINT test_constraint;\nALTER TABLE public . test_table ADD CONSTRAINT test_constraint CHECK (value > 0) DEFERRABLE INITIALLY DEFERRED",
      );
    });
  });
});
