import { describe, expect, test } from "vitest";
import {
  AlterEventTriggerChangeOwner,
  AlterEventTriggerSetEnabled,
} from "./changes/event-trigger.alter.ts";
import {
  CreateCommentOnEventTrigger,
  DropCommentOnEventTrigger,
} from "./changes/event-trigger.comment.ts";
import { CreateEventTrigger } from "./changes/event-trigger.create.ts";
import { DropEventTrigger } from "./changes/event-trigger.drop.ts";
import { diffEventTriggers } from "./event-trigger.diff.ts";
import { EventTrigger, type EventTriggerProps } from "./event-trigger.model.ts";

const base: EventTriggerProps = {
  name: "ddl_logger",
  event: "ddl_command_start",
  function_schema: "public",
  function_name: "log_ddl",
  enabled: "O",
  tags: ["CREATE TABLE"],
  owner: "postgres",
  comment: null,
};

describe.concurrent("event-trigger.diff", () => {
  test("create and drop event trigger", () => {
    const eventTrigger = new EventTrigger(base);

    const created = diffEventTriggers(
      {},
      { [eventTrigger.stableId]: eventTrigger },
    );
    expect(created).toHaveLength(1);
    expect(created[0]).toBeInstanceOf(CreateEventTrigger);

    const dropped = diffEventTriggers(
      { [eventTrigger.stableId]: eventTrigger },
      {},
    );
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toBeInstanceOf(DropEventTrigger);
  });

  test("replace when non-alterable fields change", () => {
    const mainEventTrigger = new EventTrigger(base);
    const branchEventTrigger = new EventTrigger({
      ...base,
      function_name: "log_ddl_v2",
    });

    const changes = diffEventTriggers(
      { [mainEventTrigger.stableId]: mainEventTrigger },
      { [branchEventTrigger.stableId]: branchEventTrigger },
    );

    expect(changes).toHaveLength(2);
    expect(changes[0]).toBeInstanceOf(DropEventTrigger);
    expect(changes[1]).toBeInstanceOf(CreateEventTrigger);
  });

  test("alter enabled state", () => {
    const mainEventTrigger = new EventTrigger(base);
    const branchEventTrigger = new EventTrigger({
      ...base,
      enabled: "D",
    });

    const changes = diffEventTriggers(
      { [mainEventTrigger.stableId]: mainEventTrigger },
      { [branchEventTrigger.stableId]: branchEventTrigger },
    );

    expect(changes).toHaveLength(1);
    expect(changes[0]).toBeInstanceOf(AlterEventTriggerSetEnabled);
  });

  test("alter owner", () => {
    const mainEventTrigger = new EventTrigger(base);
    const branchEventTrigger = new EventTrigger({
      ...base,
      owner: "new_owner",
    });

    const changes = diffEventTriggers(
      { [mainEventTrigger.stableId]: mainEventTrigger },
      { [branchEventTrigger.stableId]: branchEventTrigger },
    );

    expect(changes).toHaveLength(1);
    expect(changes[0]).toBeInstanceOf(AlterEventTriggerChangeOwner);
  });

  test("comment changes", () => {
    const mainEventTrigger = new EventTrigger(base);
    const branchWithComment = new EventTrigger({
      ...base,
      comment: "logs ddl commands",
    });
    const branchWithoutComment = new EventTrigger({
      ...base,
      comment: null,
    });

    const createCommentChanges = diffEventTriggers(
      { [mainEventTrigger.stableId]: mainEventTrigger },
      { [branchWithComment.stableId]: branchWithComment },
    );
    expect(createCommentChanges).toHaveLength(1);
    expect(createCommentChanges[0]).toBeInstanceOf(CreateCommentOnEventTrigger);

    const dropCommentChanges = diffEventTriggers(
      { [branchWithComment.stableId]: branchWithComment },
      { [branchWithoutComment.stableId]: branchWithoutComment },
    );
    expect(dropCommentChanges).toHaveLength(1);
    expect(dropCommentChanges[0]).toBeInstanceOf(DropCommentOnEventTrigger);
  });
});
