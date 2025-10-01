import { Change } from "../../base.change.ts";
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
export class DropTrigger extends Change {
  public readonly trigger: Trigger;
  public readonly operation = "drop" as const;
  public readonly scope = "object" as const;
  public readonly objectType = "trigger" as const;

  constructor(props: { trigger: Trigger }) {
    super();
    this.trigger = props.trigger;
  }

  get dependencies() {
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
