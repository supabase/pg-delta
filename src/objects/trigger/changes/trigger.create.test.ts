import { describe, expect, test } from "vitest";
import type { ColumnProps } from "../../base.model.ts";
import { Trigger } from "../trigger.model.ts";
import { CreateTrigger } from "./trigger.create.ts";

describe("trigger", () => {
  test("create", () => {
    const trigger = new Trigger({
      schema: "public",
      name: "test_trigger",
      table_name: "test_table",
      function_schema: "public",
      function_name: "test_function",
      trigger_type: (1 << 1) | (1 << 2) | (1 << 0), // BEFORE (1<<1) | INSERT (1<<2) | ROW (1<<0) = 7
      enabled: "O",
      is_internal: false,
      deferrable: false,
      initially_deferred: false,
      argument_count: 0,
      column_numbers: null,
      arguments: [],
      when_condition: null,
      old_table: null,
      new_table: null,
      owner: "test",
    });

    const change = new CreateTrigger({
      trigger,
    });

    expect(change.serialize()).toBe(
      "CREATE TRIGGER test_trigger BEFORE INSERT ON public.test_table FOR EACH ROW EXECUTE FUNCTION public.test_function()",
    );
  });

  test("create with all options (constraint, row-level, WHEN)", () => {
    const trigger = new Trigger({
      schema: "public",
      name: "test_trigger_all",
      table_name: "test_table",
      function_schema: "public",
      function_name: "test_function",
      // BEFORE/AFTER: AFTER (default), Events: INSERT + UPDATE, Level: ROW
      trigger_type: (1 << 2) | (1 << 4) | (1 << 0),
      enabled: "O",
      is_internal: false,
      deferrable: true,
      initially_deferred: true,
      argument_count: 2,
      column_numbers: [1, 2],
      arguments: ["'arg1'", "42"],
      when_condition: "NEW.amount > 0",
      old_table: "old_t",
      new_table: "new_t",
      owner: "test",
    });

    const columns: ColumnProps[] = [
      {
        name: "id",
        position: 1,
        data_type: "integer",
        data_type_str: "integer",
        is_custom_type: false,
        custom_type_type: null,
        custom_type_category: null,
        custom_type_schema: null,
        custom_type_name: null,
        not_null: false,
        is_identity: false,
        is_identity_always: false,
        is_generated: false,
        collation: null,
        default: null,
        comment: null,
      },
      {
        name: "updated_at",
        position: 2,
        data_type: "timestamp",
        data_type_str: "timestamp",
        is_custom_type: false,
        custom_type_type: null,
        custom_type_category: null,
        custom_type_schema: null,
        custom_type_name: null,
        not_null: false,
        is_identity: false,
        is_identity_always: false,
        is_generated: false,
        collation: null,
        default: null,
        comment: null,
      },
    ];

    const change = new CreateTrigger({
      trigger,
      indexableObject: { columns },
    });

    expect(change.serialize()).toBe(
      "CREATE CONSTRAINT TRIGGER test_trigger_all AFTER INSERT OR UPDATE OF id, updated_at ON public.test_table DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.amount > 0) EXECUTE FUNCTION public.test_function('arg1', 42)",
    );
  });

  test("create with transition tables (statement-level, non-constraint, single event)", () => {
    const trigger = new Trigger({
      schema: "public",
      name: "test_trigger_transitions",
      table_name: "test_table",
      function_schema: "public",
      function_name: "test_function",
      // AFTER (default), Event: UPDATE only, Level: STATEMENT (default)
      trigger_type: 1 << 4,
      enabled: "O",
      is_internal: false,
      deferrable: false,
      initially_deferred: false,
      argument_count: 2,
      column_numbers: null,
      arguments: ["'arg1'", "42"],
      when_condition: null,
      old_table: "old_t",
      new_table: "new_t",
      owner: "test",
    });

    const columns: ColumnProps[] = [
      {
        name: "id",
        position: 1,
        data_type: "integer",
        data_type_str: "integer",
        is_custom_type: false,
        custom_type_type: null,
        custom_type_category: null,
        custom_type_schema: null,
        custom_type_name: null,
        not_null: false,
        is_identity: false,
        is_identity_always: false,
        is_generated: false,
        collation: null,
        default: null,
        comment: null,
      },
      {
        name: "updated_at",
        position: 2,
        data_type: "timestamp",
        data_type_str: "timestamp",
        is_custom_type: false,
        custom_type_type: null,
        custom_type_category: null,
        custom_type_schema: null,
        custom_type_name: null,
        not_null: false,
        is_identity: false,
        is_identity_always: false,
        is_generated: false,
        collation: null,
        default: null,
        comment: null,
      },
    ];

    const change = new CreateTrigger({
      trigger,
      indexableObject: { columns },
    });

    expect(change.serialize()).toBe(
      "CREATE TRIGGER test_trigger_transitions AFTER UPDATE ON public.test_table REFERENCING OLD TABLE AS old_t NEW TABLE AS new_t EXECUTE FUNCTION public.test_function('arg1', 42)",
    );
  });

  test("create INSTEAD OF trigger", () => {
    const trigger = new Trigger({
      schema: "public",
      name: "test_trigger_instead",
      table_name: "test_table",
      function_schema: "public",
      function_name: "test_function",
      // INSTEAD OF | INSERT | ROW
      trigger_type: (1 << 6) | (1 << 2) | (1 << 0),
      enabled: "O",
      is_internal: false,
      deferrable: false,
      initially_deferred: false,
      argument_count: 0,
      column_numbers: null,
      arguments: [],
      when_condition: null,
      old_table: null,
      new_table: null,
      owner: "test",
    });

    const change = new CreateTrigger({
      trigger,
    });

    expect(change.serialize()).toBe(
      "CREATE TRIGGER test_trigger_instead INSTEAD OF INSERT ON public.test_table FOR EACH ROW EXECUTE FUNCTION public.test_function()",
    );
  });

  test("create DELETE (statement-level)", () => {
    const trigger = new Trigger({
      schema: "public",
      name: "test_trigger_delete",
      table_name: "test_table",
      function_schema: "public",
      function_name: "test_function",
      // AFTER (default) | DELETE | STATEMENT (default)
      trigger_type: 1 << 3,
      enabled: "O",
      is_internal: false,
      deferrable: false,
      initially_deferred: false,
      argument_count: 0,
      column_numbers: null,
      arguments: [],
      when_condition: null,
      old_table: null,
      new_table: null,
      owner: "test",
    });

    const change = new CreateTrigger({ trigger });

    expect(change.serialize()).toBe(
      "CREATE TRIGGER test_trigger_delete AFTER DELETE ON public.test_table EXECUTE FUNCTION public.test_function()",
    );
  });

  test("create TRUNCATE (statement-level)", () => {
    const trigger = new Trigger({
      schema: "public",
      name: "test_trigger_truncate",
      table_name: "test_table",
      function_schema: "public",
      function_name: "test_function",
      // AFTER (default) | TRUNCATE | STATEMENT (default)
      trigger_type: 1 << 5,
      enabled: "O",
      is_internal: false,
      deferrable: false,
      initially_deferred: false,
      argument_count: 0,
      column_numbers: null,
      arguments: [],
      when_condition: null,
      old_table: null,
      new_table: null,
      owner: "test",
    });

    const change = new CreateTrigger({ trigger });

    expect(change.serialize()).toBe(
      "CREATE TRIGGER test_trigger_truncate AFTER TRUNCATE ON public.test_table EXECUTE FUNCTION public.test_function()",
    );
  });

  test("create UPDATE OF with columns mapping (statement-level)", () => {
    const trigger = new Trigger({
      schema: "public",
      name: "test_trigger_update_of",
      table_name: "test_table",
      function_schema: "public",
      function_name: "test_function",
      // AFTER (default), UPDATE only, STATEMENT (default)
      trigger_type: 1 << 4,
      enabled: "O",
      is_internal: false,
      deferrable: false,
      initially_deferred: false,
      argument_count: 0,
      column_numbers: [2],
      arguments: [],
      when_condition: null,
      old_table: null,
      new_table: null,
      owner: "test",
    });

    const columns: ColumnProps[] = [
      {
        name: "id",
        position: 1,
        data_type: "integer",
        data_type_str: "integer",
        is_custom_type: false,
        custom_type_type: null,
        custom_type_category: null,
        custom_type_schema: null,
        custom_type_name: null,
        not_null: false,
        is_identity: false,
        is_identity_always: false,
        is_generated: false,
        collation: null,
        default: null,
        comment: null,
      },
      {
        name: "updated_at",
        position: 2,
        data_type: "timestamp",
        data_type_str: "timestamp",
        is_custom_type: false,
        custom_type_type: null,
        custom_type_category: null,
        custom_type_schema: null,
        custom_type_name: null,
        not_null: false,
        is_identity: false,
        is_identity_always: false,
        is_generated: false,
        collation: null,
        default: null,
        comment: null,
      },
    ];

    const change = new CreateTrigger({ trigger, indexableObject: { columns } });

    expect(change.serialize()).toBe(
      "CREATE TRIGGER test_trigger_update_of AFTER UPDATE OF updated_at ON public.test_table EXECUTE FUNCTION public.test_function()",
    );
  });

  test("create UPDATE OF with quoted column names (statement-level)", () => {
    const trigger = new Trigger({
      schema: "public",
      name: "test_trigger_update_of_quoted",
      table_name: "test_table",
      function_schema: "public",
      function_name: "test_function",
      // AFTER (default), UPDATE only, STATEMENT (default)
      trigger_type: 1 << 4,
      enabled: "O",
      is_internal: false,
      deferrable: false,
      initially_deferred: false,
      argument_count: 0,
      column_numbers: [1, 2],
      arguments: [],
      when_condition: null,
      old_table: null,
      new_table: null,
      owner: "test",
    });

    const columns: ColumnProps[] = [
      {
        name: "User", // requires quoting due to uppercase
        position: 1,
        data_type: "text",
        data_type_str: "text",
        is_custom_type: false,
        custom_type_type: null,
        custom_type_category: null,
        custom_type_schema: null,
        custom_type_name: null,
        not_null: false,
        is_identity: false,
        is_identity_always: false,
        is_generated: false,
        collation: null,
        default: null,
        comment: null,
      },
      {
        name: "select", // reserved keyword; requires quoting
        position: 2,
        data_type: "text",
        data_type_str: "text",
        is_custom_type: false,
        custom_type_type: null,
        custom_type_category: null,
        custom_type_schema: null,
        custom_type_name: null,
        not_null: false,
        is_identity: false,
        is_identity_always: false,
        is_generated: false,
        collation: null,
        default: null,
        comment: null,
      },
    ];

    const change = new CreateTrigger({ trigger, indexableObject: { columns } });

    expect(change.serialize()).toBe(
      'CREATE TRIGGER test_trigger_update_of_quoted AFTER UPDATE OF "User", "select" ON public.test_table EXECUTE FUNCTION public.test_function()',
    );
  });
});
