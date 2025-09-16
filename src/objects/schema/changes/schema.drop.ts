import { DropChange } from "../../base.change.ts";
import type { Schema } from "../schema.model.ts";

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
export class DropSchema extends DropChange {
  public readonly schema: Schema;

  constructor(props: { schema: Schema }) {
    super();
    this.schema = props.schema;
  }

  get dependencies() {
    return [this.schema.stableId];
  }

  serialize(): string {
    return ["DROP SCHEMA", this.schema.schema].join(" ");
  }
}
