import { Change } from "../../base.change.ts";
import type { Schema } from "../schema.model.ts";

/**
 * Alter a schema.
 *
 * @see https://www.postgresql.org/docs/17/sql-alterschema.html
 *
 * Synopsis
 * ```sql
 * ALTER SCHEMA name RENAME TO new_name
 * ALTER SCHEMA name OWNER TO { new_owner | CURRENT_ROLE | CURRENT_USER | SESSION_USER }
 * ```
 */

/**
 * ALTER SCHEMA ... OWNER TO ...
 */
export class AlterSchemaChangeOwner extends Change {
  public readonly main: Schema;
  public readonly branch: Schema;
  public readonly operation = "alter" as const;
  public readonly scope = "object" as const;
  public readonly objectType = "schema" as const;

  constructor(props: { main: Schema; branch: Schema }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get dependencies() {
    return [this.main.stableId];
  }

  serialize(): string {
    return [
      "ALTER SCHEMA",
      this.main.schema,
      "OWNER TO",
      this.branch.owner,
    ].join(" ");
  }
}

/**
 * Replace a schema by dropping and recreating it.
 * This is used when properties that cannot be altered via ALTER SCHEMA change.
 */
// NOTE: ReplaceSchema removed. Non-alterable changes would be emitted via Drop + Create in schema.diff.ts if needed.
