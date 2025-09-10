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
function decodeTriggerTiming(triggerType: number): string {
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
 * Based on PostgreSQL macros: TRIGGER_FOR_ROW
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
  public readonly indexableObject?: TableLikeObject;

  constructor(props: { trigger: Trigger; indexableObject?: TableLikeObject }) {
    super();
    this.trigger = props.trigger;
    this.indexableObject = props.indexableObject;
  }

  get stableId(): string {
    return `${this.trigger.stableId}`;
  }

  private resolveUpdateOfColumns(): string[] | null {
    // Only relevant for UPDATE triggers with specified columns
    if (
      !this.trigger.column_numbers ||
      this.trigger.column_numbers.length === 0
    ) {
      return null;
    }
    // In extracted catalogs, indexableObject is always available for base tables
    // and materialized views. If missing here, consider it a programming error.
    if (!this.indexableObject) {
      throw new Error(
        "CreateTrigger requires indexableObject to resolve column_numbers for UPDATE OF",
      );
    }
    const columnByPosition = new Map<number, string>();
    for (const col of this.indexableObject.columns) {
      columnByPosition.set(col.position, col.name);
    }
    const names: string[] = [];
    for (const pos of this.trigger.column_numbers) {
      const name = columnByPosition.get(pos);
      if (!name) {
        throw new Error(
          `CreateTrigger could not resolve column position ${pos} to a column name`,
        );
      }
      names.push(name);
    }
    return names;
  }

  serialize(): string {
    const parts: string[] = ["CREATE"];

    // Only constraint triggers can be DEFERRABLE. When the model reports
    // deferrable/initially_deferred, emit the CONSTRAINT keyword.
    const isConstraint =
      this.trigger.deferrable || this.trigger.initially_deferred;
    if (isConstraint) parts.push("CONSTRAINT");
    parts.push("TRIGGER");

    // Add trigger name
    parts.push(this.trigger.name);

    // Add timing (decoded from trigger_type)
    const timing = decodeTriggerTiming(this.trigger.trigger_type);
    parts.push(timing);

    // Decode events and determine if REFERENCING can be emitted
    const events = decodeTriggerEvents(this.trigger.trigger_type);
    const levelEarly = decodeTriggerLevel(this.trigger.trigger_type);
    const canUseReferencing =
      (this.trigger.old_table || this.trigger.new_table) &&
      !isConstraint &&
      levelEarly === "FOR EACH STATEMENT" &&
      timing === "AFTER" &&
      events.length === 1 &&
      events[0] !== "TRUNCATE";

    // Add events (decoded), enhancing UPDATE with OF columns when allowed
    const updateOf = canUseReferencing ? null : this.resolveUpdateOfColumns();
    const eventsSql = events
      .map((ev) =>
        ev === "UPDATE" && updateOf && updateOf.length > 0
          ? `UPDATE OF ${updateOf.join(", ")}`
          : ev,
      )
      .join(" OR ");
    parts.push(eventsSql);

    // Add ON table
    parts.push("ON", `${this.trigger.schema}.${this.trigger.table_name}`);

    // Add deferrable options for constraint triggers.
    // Defaults are NOT DEFERRABLE and INITIALLY IMMEDIATE, so omit them.
    if (isConstraint && this.trigger.deferrable) {
      parts.push("DEFERRABLE");
      if (this.trigger.initially_deferred) {
        parts.push("INITIALLY DEFERRED");
      }
    }

    // Add REFERENCING transition tables when present
    // Only valid for non-constraint, statement-level, AFTER triggers
    if (
      (this.trigger.old_table || this.trigger.new_table) &&
      !isConstraint &&
      decodeTriggerLevel(this.trigger.trigger_type) === "FOR EACH STATEMENT" &&
      timing === "AFTER"
    ) {
      const referencing: string[] = ["REFERENCING"];
      if (this.trigger.old_table) {
        referencing.push("OLD TABLE AS", this.trigger.old_table);
      }
      if (this.trigger.new_table) {
        // Separate with space; previous pushes ensure spacing
        referencing.push("NEW TABLE AS", this.trigger.new_table);
      }
      parts.push(referencing.join(" "));
    }

    // Add FOR EACH ...
    // Default is FOR EACH STATEMENT; emit only FOR EACH ROW when applicable.
    const level = decodeTriggerLevel(this.trigger.trigger_type);
    if (level === "FOR EACH ROW") {
      parts.push(level);
    }

    // Add WHEN condition (only applicable to row-level triggers)
    if (
      this.trigger.when_condition &&
      decodeTriggerLevel(this.trigger.trigger_type) === "FOR EACH ROW"
    ) {
      parts.push("WHEN", `(${this.trigger.when_condition})`);
    }

    // Add EXECUTE FUNCTION with arguments (no space before parentheses)
    const functionCall =
      this.trigger.arguments && this.trigger.arguments.length > 0
        ? `${this.trigger.function_schema}.${this.trigger.function_name}(${this.trigger.arguments.join(", ")})`
        : `${this.trigger.function_schema}.${this.trigger.function_name}()`;

    parts.push("EXECUTE FUNCTION", functionCall);

    return parts.join(" ");
  }
}
