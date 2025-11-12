import { describe, expect, test } from "vitest";
import { EventTrigger } from "../event-trigger.model.ts";
import {
  AlterEventTriggerChangeOwner,
  AlterEventTriggerSetEnabled,
} from "./event-trigger.alter.ts";

describe("event trigger alter change", () => {
  const baseEventTrigger = new EventTrigger({
    name: "ddl_logger",
    event: "ddl_command_start",
    function_schema: "public",
    function_name: "log_ddl",
    enabled: "O",
    tags: null,
    owner: "postgres",
    comment: null,
  });

  test("serialize owner change", () => {
    const change = new AlterEventTriggerChangeOwner({
      eventTrigger: baseEventTrigger,
      owner: "new_owner",
    });

    expect(change.serialize()).toBe(
      "ALTER EVENT TRIGGER ddl_logger OWNER TO new_owner",
    );
  });

  test("serialize disable", () => {
    const change = new AlterEventTriggerSetEnabled({
      eventTrigger: baseEventTrigger,
      enabled: "D",
    });

    expect(change.serialize()).toBe("ALTER EVENT TRIGGER ddl_logger DISABLE");
  });

  test("serialize enable always", () => {
    const change = new AlterEventTriggerSetEnabled({
      eventTrigger: baseEventTrigger,
      enabled: "A",
    });

    expect(change.serialize()).toBe(
      "ALTER EVENT TRIGGER ddl_logger ENABLE ALWAYS",
    );
  });
});
