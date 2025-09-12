import { describe, expect, test } from "vitest";
import { Trigger, type TriggerProps } from "../trigger.model.ts";
import { ReplaceTrigger } from "./trigger.alter.ts";

describe.concurrent("trigger", () => {
  describe("alter", () => {
    test("replace trigger", () => {
      const props: Omit<TriggerProps, "enabled"> = {
        schema: "public",
        name: "test_trigger",
        table_name: "test_table",
        function_schema: "public",
        function_name: "test_function",
        trigger_type: 1 << 4, // UPDATE (1<<4) = 16, AFTER is default (0), STATEMENT is default (0)
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
        definition:
          "CREATE TRIGGER test_trigger AFTER UPDATE ON public.test_table DEFERRABLE EXECUTE FUNCTION public.test_function()",
      };
      const main = new Trigger({
        ...props,
        enabled: "O",
      });
      const branch = new Trigger({
        ...props,
        enabled: "D",
      });

      const change = new ReplaceTrigger({
        main,
        branch,
      });

      expect(change.serialize()).toBe(
        "CREATE OR REPLACE TRIGGER test_trigger AFTER UPDATE ON public.test_table DEFERRABLE EXECUTE FUNCTION public.test_function()",
      );
    });
  });
});
