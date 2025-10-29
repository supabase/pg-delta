import type { TableLikeObject } from "../../base.model.ts";
import type { Trigger } from "../trigger.model.ts";
import { AlterTriggerChange } from "./trigger.base.ts";
import { CreateTrigger } from "./trigger.create.ts";

/**
 * Alter a trigger.
 *
 * @see https://www.postgresql.org/docs/17/sql-altertrigger.html
 *
 * Synopsis
 * ```sql
 * ALTER TRIGGER name ON table_name RENAME TO new_name
 * ```
 */

export type AlterTrigger = ReplaceTrigger;

/**
 * Replace a trigger by dropping and recreating it.
 * This is used when properties that cannot be altered via ALTER TRIGGER change.
 */
export class ReplaceTrigger extends AlterTriggerChange {
  public readonly trigger: Trigger;
  public readonly indexableObject?: TableLikeObject;
  public readonly scope = "object" as const;

  constructor(props: {
    trigger: Trigger;
    indexableObject?: TableLikeObject;
  }) {
    super();
    this.trigger = props.trigger;
    this.indexableObject = props.indexableObject;
  }

  get requires() {
    return [this.trigger.stableId];
  }

  serialize(): string {
    const createChange = new CreateTrigger({
      trigger: this.trigger,
      indexableObject: this.indexableObject,
      orReplace: true,
    });

    return createChange.serialize();
  }
}
