import { CreateChange } from "../../base.change.ts";
import type { TableLikeObject } from "../../base.model.ts";
import type { Trigger } from "../trigger.model.ts";

/**
 * Create a trigger.
 *
 * @see https://www.postgresql.org/docs/17/sql-createtrigger.html
 *
 * Synopsis
 * ```sql
 * CREATE [ CONSTRAINT ] TRIGGER name { BEFORE | AFTER | INSTEAD OF } { event [ OR ... ] }
 *     ON table_name
 *     [ FROM referenced_table_name ]
 *     [ NOT DEFERRABLE | [ DEFERRABLE ] { INITIALLY IMMEDIATE | INITIALLY DEFERRED } ]
 *     [ REFERENCING { { OLD | NEW } TABLE [ AS ] transition_relation_name } [ ... ] ]
 *     [ FOR [ EACH ] { ROW | STATEMENT } ]
 *     [ WHEN ( condition ) ]
 *     EXECUTE { FUNCTION | PROCEDURE } function_name ( arguments )
 * ```
 */
export class CreateTrigger extends CreateChange {
  public readonly trigger: Trigger;
  public readonly indexableObject?: TableLikeObject;

  constructor(props: { trigger: Trigger; indexableObject?: TableLikeObject }) {
    super();
    this.trigger = props.trigger;
    this.indexableObject = props.indexableObject;
  }

  get stableId(): string {
    return `${this.trigger.stableId}`;
  }

  serialize(): string {
    return this.trigger.definition;
  }
}
