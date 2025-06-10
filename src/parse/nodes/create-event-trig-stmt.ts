import type { CreateEventTrigStmt } from "@supabase/pg-parser/17/types";
import type { ParseContext } from "../types/context.ts";
import type { EventTriggerDefinition } from "../types/objects/event-trigger.ts";

export function handleCreateEventTrigStmt(
  ctx: ParseContext,
  node: CreateEventTrigStmt,
) {
  if (!node.trigname) return;

  const eventTriggerDefinition: EventTriggerDefinition = {
    id: node.trigname,
    name: node.trigname,
    statement: node,
  };

  ctx.eventTriggers.set(node.trigname, eventTriggerDefinition);
}
