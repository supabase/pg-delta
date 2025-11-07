import type { Trigger } from "../trigger.model.ts";
import { DropTriggerChange } from "./trigger.base.ts";

/**
 * Drop a trigger.
 *
 * @see https://www.postgresql.org/docs/17/sql-droptrigger.html
 *
 * Synopsis
 * ```sql
 * DROP TRIGGER [ IF EXISTS ] name ON table_name [ CASCADE | RESTRICT ]
 * ```
 */
export class DropTrigger extends DropTriggerChange {
  public readonly trigger: Trigger;
  public readonly scope = "object" as const;

  constructor(props: { trigger: Trigger }) {
    super();
    this.trigger = props.trigger;
  }

  get drops() {
    return [this.trigger.stableId];
  }

  get requires() {
    return [this.trigger.stableId];
  }

  serialize(): string {
    return [
      "DROP TRIGGER",
      this.trigger.name,
      "ON",
      `${this.trigger.schema}.${this.trigger.table_name}`,
    ].join(" ");
  }
}
