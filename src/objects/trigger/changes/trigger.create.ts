import { CreateChange, quoteIdentifier } from "../../base.change.ts";
import type { Trigger } from "../trigger.model.ts";

/**
 * PostgreSQL trigger type constants
 * Based on PostgreSQL source code: src/include/commands/trigger.h
 */
const TRIGGER_TYPE_ROW = 4; // 0x04 - FOR EACH ROW
const TRIGGER_TYPE_BEFORE = 32; // 0x20 - BEFORE
const TRIGGER_TYPE_AFTER = 64; // 0x40 - AFTER
const TRIGGER_TYPE_INSTEAD = 128; // 0x80 - INSTEAD OF
const TRIGGER_TYPE_INSERT = 1; // 0x01 - INSERT
const TRIGGER_TYPE_UPDATE = 2; // 0x02 - UPDATE
const TRIGGER_TYPE_DELETE = 4; // 0x04 - DELETE
const TRIGGER_TYPE_TRUNCATE = 8; // 0x08 - TRUNCATE

/**
 * Decode trigger timing from trigger_type
 */
function decodeTriggerTiming(triggerType: number): string {
  if (triggerType & TRIGGER_TYPE_INSTEAD) {
    return "INSTEAD OF";
  } else if (triggerType & TRIGGER_TYPE_BEFORE) {
    return "BEFORE";
  } else if (triggerType & TRIGGER_TYPE_AFTER) {
    return "AFTER";
  }
  return "AFTER"; // Default fallback
}

/**
 * Decode trigger events from trigger_type
 */
function decodeTriggerEvents(triggerType: number): string[] {
  const events: string[] = [];

  if (triggerType & TRIGGER_TYPE_INSERT) {
    events.push("INSERT");
  }
  if (triggerType & TRIGGER_TYPE_UPDATE) {
    events.push("UPDATE");
  }
  if (triggerType & TRIGGER_TYPE_DELETE) {
    events.push("DELETE");
  }
  if (triggerType & TRIGGER_TYPE_TRUNCATE) {
    events.push("TRUNCATE");
  }

  return events;
}

/**
 * Decode trigger level from trigger_type
 */
function decodeTriggerLevel(triggerType: number): string {
  if (triggerType & TRIGGER_TYPE_ROW) {
    return "FOR EACH ROW";
  }
  return "FOR EACH STATEMENT";
}

/**
 * Create a trigger.
 *
 * @see https://www.postgresql.org/docs/17/sql-createtrigger.html
 *
 * Synopsis
 * ```sql
 * CREATE [ CONSTRAINT ] TRIGGER name { BEFORE | AFTER | INSTEAD OF } { event [ OR ... ] }
 *     ON table_name
 *     [ FROM referenced_table_name ]
 *     [ NOT DEFERRABLE | [ DEFERRABLE ] { INITIALLY IMMEDIATE | INITIALLY DEFERRED } ]
 *     [ REFERENCING { { OLD | NEW } TABLE [ AS ] transition_relation_name } [ ... ] ]
 *     [ FOR [ EACH ] { ROW | STATEMENT } ]
 *     [ WHEN ( condition ) ]
 *     EXECUTE { FUNCTION | PROCEDURE } function_name ( arguments )
 * ```
 */
export class CreateTrigger extends CreateChange {
  public readonly trigger: Trigger;

  constructor(props: { trigger: Trigger }) {
    super();
    this.trigger = props.trigger;
  }

  serialize(): string {
    const parts: string[] = ["CREATE TRIGGER"];

    // Add trigger name
    parts.push(quoteIdentifier(this.trigger.name));

    // Add timing (decoded from trigger_type)
    parts.push(decodeTriggerTiming(this.trigger.trigger_type));

    // Add events (decoded from trigger_type)
    const events = decodeTriggerEvents(this.trigger.trigger_type);
    parts.push(events.join(" OR "));

    // Add ON table
    parts.push(
      "ON",
      `${quoteIdentifier(this.trigger.table_schema)}.${quoteIdentifier(this.trigger.table_name)}`,
    );

    // Add deferrable options
    if (this.trigger.deferrable) {
      parts.push("DEFERRABLE");
      if (this.trigger.initially_deferred) {
        parts.push("INITIALLY DEFERRED");
      } else {
        parts.push("INITIALLY IMMEDIATE");
      }
    } else {
      parts.push("NOT DEFERRABLE");
    }

    // Add FOR EACH ROW/STATEMENT (decoded from trigger_type)
    parts.push(decodeTriggerLevel(this.trigger.trigger_type));

    // Add WHEN condition
    if (this.trigger.when_condition) {
      parts.push("WHEN", `(${this.trigger.when_condition})`);
    }

    // Add EXECUTE FUNCTION
    parts.push(
      "EXECUTE FUNCTION",
      `${quoteIdentifier(this.trigger.function_schema)}.${quoteIdentifier(this.trigger.function_name)}`,
    );

    // Add arguments
    if (this.trigger.arguments && this.trigger.arguments.length > 0) {
      parts.push(`(${this.trigger.arguments.join(", ")})`);
    }

    return parts.join(" ");
  }
}
