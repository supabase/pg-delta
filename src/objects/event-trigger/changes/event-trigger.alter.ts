import type { EventTrigger } from "../event-trigger.model.ts";
import { AlterEventTriggerChange } from "./event-trigger.base.ts";

/**
 * Alter an event trigger.
 *
 * @see https://www.postgresql.org/docs/17/sql-altereventtrigger.html
 *
 * Synopsis
 * ```sql
 * ALTER EVENT TRIGGER name DISABLE
 * ALTER EVENT TRIGGER name ENABLE [ REPLICA | ALWAYS ]
 * ALTER EVENT TRIGGER name OWNER TO { newowner | CURRENT_ROLE | CURRENT_USER | SESSION_USER }
 * ALTER EVENT TRIGGER name RENAME TO newname
 * ```
 */

export type AlterEventTrigger =
  | AlterEventTriggerChangeOwner
  | AlterEventTriggerSetEnabled;

/**
 * ALTER EVENT TRIGGER ... OWNER TO ...
 */
export class AlterEventTriggerChangeOwner extends AlterEventTriggerChange {
  public readonly eventTrigger: EventTrigger;
  public readonly owner: string;
  public readonly scope = "object" as const;

  constructor(props: { eventTrigger: EventTrigger; owner: string }) {
    super();
    this.eventTrigger = props.eventTrigger;
    this.owner = props.owner;
  }

  get requires() {
    return [this.eventTrigger.stableId];
  }

  serialize(): string {
    return [
      "ALTER EVENT TRIGGER",
      this.eventTrigger.name,
      "OWNER TO",
      this.owner,
    ].join(" ");
  }
}

const ENABLED_SQL = {
  O: "ENABLE",
  D: "DISABLE",
  R: "ENABLE REPLICA",
  A: "ENABLE ALWAYS",
} as const;

/**
 * ALTER EVENT TRIGGER ... ENABLE/DISABLE ...
 */
export class AlterEventTriggerSetEnabled extends AlterEventTriggerChange {
  public readonly eventTrigger: EventTrigger;
  public readonly enabled: EventTrigger["enabled"];
  public readonly scope = "object" as const;

  constructor(props: {
    eventTrigger: EventTrigger;
    enabled: EventTrigger["enabled"];
  }) {
    super();
    this.eventTrigger = props.eventTrigger;
    this.enabled = props.enabled;
  }

  get requires() {
    return [this.eventTrigger.stableId];
  }

  serialize(): string {
    const clause = ENABLED_SQL[this.enabled];
    return ["ALTER EVENT TRIGGER", this.eventTrigger.name, clause].join(" ");
  }
}
