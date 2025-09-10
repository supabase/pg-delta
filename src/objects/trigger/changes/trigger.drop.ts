import { DropChange } from "../../base.change.ts";
import type { Trigger } from "../trigger.model.ts";

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
export class DropTrigger extends DropChange {
  public readonly trigger: Trigger;

  constructor(props: { trigger: Trigger }) {
    super();
    this.trigger = props.trigger;
  }

  get stableId(): string {
    return `${this.trigger.stableId}`;
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
