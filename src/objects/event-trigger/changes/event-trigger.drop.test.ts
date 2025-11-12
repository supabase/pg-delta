import { describe, expect, test } from "vitest";
import { EventTrigger } from "../event-trigger.model.ts";
import { DropEventTrigger } from "./event-trigger.drop.ts";

describe("event trigger drop change", () => {
  test("serialize drop event trigger", () => {
    const eventTrigger = new EventTrigger({
      name: "ddl_logger",
      event: "ddl_command_start",
      function_schema: "public",
      function_name: "log_ddl",
      enabled: "O",
      tags: null,
      owner: "postgres",
      comment: null,
    });

    const change = new DropEventTrigger({ eventTrigger });

    expect(change.serialize()).toBe("DROP EVENT TRIGGER ddl_logger");
  });
});
