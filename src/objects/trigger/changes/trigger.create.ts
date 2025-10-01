import { Change } from "../../base.change.ts";
import type { TableLikeObject } from "../../base.model.ts";
import type { Trigger } from "../trigger.model.ts";

/**
 * Create a trigger.
 *
 * @see https://www.postgresql.org/docs/17/sql-createtrigger.html
 *
 * Synopsis
 * ```sql
 * CREATE [ OR REPLACE ] [ CONSTRAINT ] TRIGGER name { BEFORE | AFTER | INSTEAD OF } { event [ OR ... ] }
 *     ON table_name
 *     [ FROM referenced_table_name ]
 *     [ NOT DEFERRABLE | [ DEFERRABLE ] [ INITIALLY IMMEDIATE | INITIALLY DEFERRED ] ]
 *     [ REFERENCING { { OLD | NEW } TABLE [ AS ] transition_relation_name } [ ... ] ]
 *     [ FOR [ EACH ] { ROW | STATEMENT } ]
 *     [ WHEN ( condition ) ]
 *     EXECUTE { FUNCTION | PROCEDURE } function_name ( arguments )
 *
 * where event can be one of:
 *
 *     INSERT
 *     UPDATE [ OF column_name [, ... ] ]
 *     DELETE
 *     TRUNCATE
 * ```
 */
export class CreateTrigger extends Change {
  public readonly trigger: Trigger;
  public readonly indexableObject?: TableLikeObject;
  public readonly orReplace?: boolean;
  public readonly operation = "create" as const;
  public readonly scope = "object" as const;
  public readonly objectType = "trigger" as const;

  constructor(props: {
    trigger: Trigger;
    indexableObject?: TableLikeObject;
    orReplace?: boolean;
  }) {
    super();
    this.trigger = props.trigger;
    this.indexableObject = props.indexableObject;
    this.orReplace = props.orReplace;
  }

  get dependencies() {
    return [this.trigger.stableId];
  }

  serialize(): string {
    let definition = this.trigger.definition.trim();

    definition = definition.replace(
      /^CREATE\s+(?:OR\s+REPLACE\s+)?/i,
      `CREATE ${this.orReplace ? "OR REPLACE " : ""}`,
    );

    return definition;
  }
}
