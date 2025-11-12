import { describe, expect, test } from "vitest";
import { EventTrigger } from "../event-trigger.model.ts";
import { CreateEventTrigger } from "./event-trigger.create.ts";

describe("event trigger create change", () => {
  test("serialize create event trigger", () => {
    const eventTrigger = new EventTrigger({
      name: "ddl_logger",
      event: "ddl_command_start",
      function_schema: "public",
      function_name: "log_ddl",
      enabled: "O",
      tags: ["CREATE TABLE", "ALTER TABLE"],
      owner: "postgres",
      comment: null,
    });

    const change = new CreateEventTrigger({ eventTrigger });

    expect(change.serialize()).toBe(
      "CREATE EVENT TRIGGER ddl_logger ON ddl_command_start WHEN TAG IN ('CREATE TABLE', 'ALTER TABLE') EXECUTE FUNCTION public.log_ddl()",
    );
  });
});
