import type { EventTrigger } from "../event-trigger.model.ts";
import { DropEventTriggerChange } from "./event-trigger.base.ts";

/**
 * Drop an event trigger.
 *
 * @see https://www.postgresql.org/docs/17/sql-dropeventtrigger.html
 *
 * Synopsis
 * ```sql
 * DROP EVENT TRIGGER [ IF EXISTS ] name [ CASCADE | RESTRICT ]
 * ```
 */
export class DropEventTrigger extends DropEventTriggerChange {
  public readonly eventTrigger: EventTrigger;
  public readonly scope = "object" as const;

  constructor(props: { eventTrigger: EventTrigger }) {
    super();
    this.eventTrigger = props.eventTrigger;
  }

  get drops() {
    return [this.eventTrigger.stableId];
  }

  get requires() {
    return [this.eventTrigger.stableId];
  }

  serialize(): string {
    return ["DROP EVENT TRIGGER", this.eventTrigger.name].join(" ");
  }
}
