import { describe, expect, test } from "vitest";
import { Trigger } from "../trigger.model.ts";
import { DropTrigger } from "./trigger.drop.ts";

describe("trigger", () => {
  test("drop", () => {
    const trigger = new Trigger({
      schema: "public",
      name: "test_trigger",
      table_schema: "public",
      table_name: "test_table",
      function_schema: "public",
      function_name: "test_function",
      trigger_type: 66,
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

    const change = new DropTrigger({
      trigger,
    });

    expect(change.serialize()).toBe(
      "DROP TRIGGER test_trigger ON public.test_table",
    );
  });
});
