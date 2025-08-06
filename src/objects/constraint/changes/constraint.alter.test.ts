import { describe, expect, test } from "vitest";
import { Constraint } from "../constraint.model.ts";
import { ReplaceConstraint } from "./constraint.alter.ts";

describe.concurrent("constraint", () => {
  describe("alter", () => {
    test("replace constraint", () => {
      const main = new Constraint({
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
      const branch = new Constraint({
        schema: "public",
        name: "test_constraint",
        table_schema: "public",
        table_name: "test_table",
        constraint_type: "c",
        deferrable: true,
        initially_deferred: true,
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
