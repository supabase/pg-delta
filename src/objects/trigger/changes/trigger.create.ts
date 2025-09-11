import { CreateChange } from "../../base.change.ts";
import type { TableLikeObject } from "../../base.model.ts";
import type { Trigger } from "../trigger.model.ts";

/**
 * PostgreSQL trigger type constants
 * Based on PostgreSQL source code: https://github.com/postgres/postgres/blob/572c0f1b0e2a9ed61816239f59d568217079bb8c/src/include/catalog/pg_trigger.h
 */
const TRIGGER_TYPE_ROW = 1 << 0; // FOR EACH ROW
const TRIGGER_TYPE_BEFORE = 1 << 1; // BEFORE
const TRIGGER_TYPE_INSERT = 1 << 2; // INSERT
const TRIGGER_TYPE_DELETE = 1 << 3; // DELETE
const TRIGGER_TYPE_UPDATE = 1 << 4; // UPDATE
const TRIGGER_TYPE_TRUNCATE = 1 << 5; // TRUNCATE
const TRIGGER_TYPE_INSTEAD = 1 << 6; // INSTEAD OF
const TRIGGER_TYPE_TIMING_MASK = TRIGGER_TYPE_BEFORE | TRIGGER_TYPE_INSTEAD;

/**
 * Decode trigger timing from trigger_type
 * Based on PostgreSQL macros: TRIGGER_FOR_BEFORE, TRIGGER_FOR_AFTER, TRIGGER_FOR_INSTEAD
 */
function _decodeTriggerTiming(triggerType: number): string {
  if ((triggerType & TRIGGER_TYPE_TIMING_MASK) === TRIGGER_TYPE_INSTEAD) {
    return "INSTEAD OF";
  } else if ((triggerType & TRIGGER_TYPE_TIMING_MASK) === TRIGGER_TYPE_BEFORE) {
    return "BEFORE";
  } else {
    return "AFTER"; // Default when no timing bit is set
  }
}

/**
 * Decode trigger events from trigger_type
 */
function _decodeTriggerEvents(triggerType: number): string[] {
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
 * Based on PostgreSQL macros: TRIGGER_FOR_ROW
 */
function _decodeTriggerLevel(triggerType: number): string {
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
  public readonly indexableObject?: TableLikeObject;

  constructor(props: { trigger: Trigger; indexableObject?: TableLikeObject }) {
    super();
    this.trigger = props.trigger;
    this.indexableObject = props.indexableObject;
  }

  get stableId(): string {
    return `${this.trigger.stableId}`;
  }

  serialize(): string {
    return this.trigger.definition;
  }
}
