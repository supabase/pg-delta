import { DropChange, quoteIdentifier } from "../../base.change.ts";
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

  serialize(): string {
    return [
      "DROP TRIGGER",
      quoteIdentifier(this.trigger.name),
      "ON",
      `${quoteIdentifier(this.trigger.table_schema)}.${quoteIdentifier(this.trigger.table_name)}`,
    ].join(" ");
  }
}
