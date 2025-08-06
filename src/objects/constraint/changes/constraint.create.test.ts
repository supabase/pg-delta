import { describe, expect, test } from "vitest";
import { Constraint } from "../constraint.model.ts";
import { CreateConstraint } from "./constraint.create.ts";

describe("constraint", () => {
  test("create check constraint", () => {
    const constraint = new Constraint({
      schema: "public",
      name: "test_check",
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

    const change = new CreateConstraint({
      constraint,
    });

    expect(change.serialize()).toBe(
      "ALTER TABLE public . test_table ADD CONSTRAINT test_check CHECK (value > 0) NOT DEFERRABLE",
    );
  });

  test("create primary key constraint", () => {
    const constraint = new Constraint({
      schema: "public",
      name: "test_pk",
      table_schema: "public",
      table_name: "test_table",
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
      owner: "test",
    });

    const change = new CreateConstraint({
      constraint,
    });

    expect(change.serialize()).toBe(
      "ALTER TABLE public . test_table ADD CONSTRAINT test_pk PRIMARY KEY NOT DEFERRABLE",
    );
  });

  test("create unique constraint", () => {
    const constraint = new Constraint({
      schema: "public",
      name: "test_unique",
      table_schema: "public",
      table_name: "test_table",
      constraint_type: "u",
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
      owner: "test",
    });

    const change = new CreateConstraint({
      constraint,
    });

    expect(change.serialize()).toBe(
      "ALTER TABLE public . test_table ADD CONSTRAINT test_unique UNIQUE NOT DEFERRABLE",
    );
  });

  test("create foreign key constraint", () => {
    const constraint = new Constraint({
      schema: "public",
      name: "test_fk",
      table_schema: "public",
      table_name: "test_table",
      constraint_type: "f",
      deferrable: false,
      initially_deferred: false,
      validated: true,
      is_local: true,
      no_inherit: false,
      key_columns: [1],
      foreign_key_columns: [1],
      foreign_key_table: "other_table",
      foreign_key_schema: "public",
      on_update: null,
      on_delete: null,
      match_type: null,
      check_expression: null,
      owner: "test",
    });

    const change = new CreateConstraint({
      constraint,
    });

    expect(change.serialize()).toBe(
      "ALTER TABLE public . test_table ADD CONSTRAINT test_fk FOREIGN KEY NOT DEFERRABLE",
    );
  });

  test("create exclude constraint", () => {
    const constraint = new Constraint({
      schema: "public",
      name: "test_exclude",
      table_schema: "public",
      table_name: "test_table",
      constraint_type: "x",
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
      owner: "test",
    });

    const change = new CreateConstraint({
      constraint,
    });

    expect(change.serialize()).toBe(
      "ALTER TABLE public . test_table ADD CONSTRAINT test_exclude EXCLUDE NOT DEFERRABLE",
    );
  });
});
