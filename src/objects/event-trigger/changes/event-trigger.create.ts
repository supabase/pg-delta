import { quoteLiteral } from "../../base.change.ts";
import type { EventTrigger } from "../event-trigger.model.ts";
import { CreateEventTriggerChange } from "./event-trigger.base.ts";

/**
 * Create an event trigger.
 *
 * @see https://www.postgresql.org/docs/17/sql-createeventtrigger.html
 *
 * Synopsis
 * ```sql
 * CREATE EVENT TRIGGER name
 *     ON event
 *     [ WHEN TAG IN (tag [, ...]) [ AND ... ] ]
 *     EXECUTE { FUNCTION | PROCEDURE } function_name()
 * ```
 */
export class CreateEventTrigger extends CreateEventTriggerChange {
  public readonly eventTrigger: EventTrigger;
  public readonly scope = "object" as const;

  constructor(props: { eventTrigger: EventTrigger }) {
    super();
    this.eventTrigger = props.eventTrigger;
  }

  get creates() {
    return [this.eventTrigger.stableId];
  }

  serialize(): string {
    const parts: string[] = [
      "CREATE EVENT TRIGGER",
      this.eventTrigger.name,
      "ON",
      this.eventTrigger.event,
    ];

    const tags = this.eventTrigger.tags;
    if (tags && tags.length > 0) {
      const tagList = tags.map((tag) => quoteLiteral(tag)).join(", ");
      parts.push("WHEN TAG IN", `(${tagList})`);
    }

    parts.push(
      "EXECUTE FUNCTION",
      `${this.eventTrigger.function_schema}.${this.eventTrigger.function_name}()`,
    );

    return parts.join(" ");
  }
}
