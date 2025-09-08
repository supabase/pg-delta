import { CreateChange } from "../../base.change.ts";
import type { Schema } from "../schema.model.ts";

/**
 * Create a schema.
 *
 * @see https://www.postgresql.org/docs/17/sql-createschema.html
 *
 * Synopsis
 * ```sql
 * CREATE SCHEMA [ IF NOT EXISTS ] schema_name [ AUTHORIZATION role_specification ] [ schema_element [ ... ] ]
 * CREATE SCHEMA [ IF NOT EXISTS ] AUTHORIZATION role_specification [ schema_element [ ... ] ]
 * CREATE SCHEMA [ IF NOT EXISTS ] schema_name AUTHORIZATION role_specification [ schema_element [ ... ] ]
 * ```
 */
export class CreateSchema extends CreateChange {
  public readonly schema: Schema;

  constructor(props: { schema: Schema }) {
    super();
    this.schema = props.schema;
  }

  get stableId(): string {
    return `${this.schema.stableId}`;
  }

  serialize(): string {
    const parts: string[] = ["CREATE SCHEMA"];

    // Add schema name
    parts.push(this.schema.schema);

    // Add AUTHORIZATION
    parts.push("AUTHORIZATION", this.schema.owner);

    return parts.join(" ");
  }
}
