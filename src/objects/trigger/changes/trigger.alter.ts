import { ReplaceChange } from "../../base.change.ts";
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

  constructor(props: { main: Trigger; branch: Trigger }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get stableId(): string {
    return `${this.main.stableId}`;
  }

  serialize(): string {
    const dropChange = new DropTrigger({ trigger: this.main });
    const createChange = new CreateTrigger({ trigger: this.branch });

    return [dropChange.serialize(), createChange.serialize()].join(";\n");
  }
}
