import { describe, expect, test } from "vitest";
import { Trigger } from "../trigger.model.ts";
import { ReplaceTrigger } from "./trigger.alter.ts";

describe.concurrent("trigger", () => {
  describe("alter", () => {
    test("replace trigger", () => {
      const main = new Trigger({
        schema: "public",
        name: "test_trigger",
        table_schema: "public",
        table_name: "test_table",
        function_schema: "public",
        function_name: "test_function",
        trigger_type: 1 << 4, // UPDATE (1<<4) = 16, AFTER is default (0), STATEMENT is default (0)
        enabled: "O",
        is_internal: false,
        deferrable: true,
        initially_deferred: false,
        argument_count: 0,
        column_numbers: null,
        arguments: [],
        when_condition: null,
        old_table: null,
        new_table: null,
        owner: "test",
      });
      const branch = new Trigger({
        schema: "public",
        name: "test_trigger",
        table_schema: "public",
        table_name: "test_table",
        function_schema: "public",
        function_name: "test_function",
        trigger_type: 1 << 4, // UPDATE (1<<4) = 16, AFTER is default (0), STATEMENT is default (0)
        enabled: "D",
        is_internal: false,
        deferrable: true,
        initially_deferred: false,
        argument_count: 0,
        column_numbers: null,
        arguments: [],
        when_condition: null,
        old_table: null,
        new_table: null,
        owner: "test",
      });

      const change = new ReplaceTrigger({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "DROP TRIGGER test_trigger ON public.test_table;\nCREATE TRIGGER test_trigger AFTER UPDATE ON public.test_table DEFERRABLE FOR EACH STATEMENT EXECUTE FUNCTION public.test_function()",
      );
    });
  });
});
