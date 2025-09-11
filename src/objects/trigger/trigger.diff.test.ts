import { describe, expect, test } from "vitest";
import { ReplaceTrigger } from "./changes/trigger.alter.ts";
import { CreateTrigger } from "./changes/trigger.create.ts";
import { DropTrigger } from "./changes/trigger.drop.ts";
import { diffTriggers } from "./trigger.diff.ts";
import { Trigger, type TriggerProps } from "./trigger.model.ts";

const base: Omit<
  TriggerProps,
  | "function_name"
  | "column_numbers"
  | "arguments"
  | "when_condition"
  | "old_table"
  | "new_table"
> = {
  schema: "public",
  name: "trg",
  table_name: "t",
  function_schema: "public",
  trigger_type: 1,
  enabled: "O",
  is_internal: false,
  deferrable: false,
  initially_deferred: false,
  argument_count: 0,
  owner: "o1",
  definition: "CREATE TRIGGER trg ON t FOR EACH ROW EXECUTE FUNCTION fn1()",
};

describe.concurrent("trigger.diff", () => {
  test("create and drop", () => {
    const trg = new Trigger({
      ...base,
      function_name: "fn1",
      column_numbers: null,
      arguments: [],
      when_condition: null,
      old_table: null,
      new_table: null,
    });

    const created = diffTriggers({}, { [trg.stableId]: trg });
    expect(created[0]).toBeInstanceOf(CreateTrigger);

    const dropped = diffTriggers({ [trg.stableId]: trg }, {});
    expect(dropped[0]).toBeInstanceOf(DropTrigger);
  });

  test("replace when non-alterable changes", () => {
    const main = new Trigger({
      ...base,
      function_name: "fn1",
      column_numbers: null,
      arguments: [],
      when_condition: null,
      old_table: null,
      new_table: null,
    });
    const branch = new Trigger({
      ...base,
      function_name: "fn2",
      column_numbers: null,
      arguments: [],
      when_condition: null,
      old_table: null,
      new_table: null,
    });

    const changes = diffTriggers(
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]).toBeInstanceOf(ReplaceTrigger);
  });
});
