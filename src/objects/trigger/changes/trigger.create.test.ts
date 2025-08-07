import { describe, expect, test } from "vitest";
import { Trigger } from "../trigger.model.ts";
import { CreateTrigger } from "./trigger.create.ts";

describe("trigger", () => {
  test("create", () => {
    const trigger = new Trigger({
      schema: "public",
      name: "test_trigger",
      table_schema: "public",
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
      "CREATE TRIGGER test_trigger BEFORE INSERT ON public.test_table EXECUTE FUNCTION public.test_function()",
    );
  });
});
