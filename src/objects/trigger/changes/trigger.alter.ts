import { ReplaceChange } from "../../base.change.ts";
import type { TableLikeObject } from "../../base.model.ts";
import type { Trigger } from "../trigger.model.ts";
import { CreateTrigger } from "./trigger.create.ts";
import { DropTrigger } from "./trigger.drop.ts";

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
export type AlterTrigger = never; // No alterable properties for triggers

/**
 * Replace a trigger by dropping and recreating it.
 * This is used when properties that cannot be altered via ALTER TRIGGER change.
 */
export class ReplaceTrigger extends ReplaceChange {
  public readonly main: Trigger;
  public readonly branch: Trigger;
  public readonly indexableObject?: TableLikeObject;

  constructor(props: {
    main: Trigger;
    branch: Trigger;
    indexableObject?: TableLikeObject;
  }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
    this.indexableObject = props.indexableObject;
  }

  get stableId(): string {
    return `${this.main.stableId}`;
  }

  serialize(): string {
    const dropChange = new DropTrigger({ trigger: this.main });
    const createChange = new CreateTrigger({
      trigger: this.branch,
      indexableObject: this.indexableObject,
    });

    return [dropChange.serialize(), createChange.serialize()].join(";\n");
  }
}
