import type { Schema } from "../schema.model.ts";
import { DropSchemaChange } from "./schema.base.ts";

/**
 * Drop a schema.
 *
 * @see https://www.postgresql.org/docs/17/sql-dropschema.html
 *
 * Synopsis
 * ```sql
 * DROP SCHEMA [ IF EXISTS ] name [, ...] [ CASCADE | RESTRICT ]
 * ```
 */
export class DropSchema extends DropSchemaChange {
  public readonly schema: Schema;
  public readonly scope = "object" as const;

  constructor(props: { schema: Schema }) {
    super();
    this.schema = props.schema;
  }

  get drops() {
    return [this.schema.stableId];
  }

  get requires() {
    return [this.schema.stableId];
  }

  serialize(): string {
    return ["DROP SCHEMA", this.schema.name].join(" ");
  }
}
