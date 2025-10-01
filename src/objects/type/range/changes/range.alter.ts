import { Change } from "../../../base.change.ts";
import type { Range } from "../range.model.ts";

/**
 * Alter a range type.
 *
 * @see https://www.postgresql.org/docs/17/sql-altertype.html
 *
 * Synopsis
 * ```sql
 * ALTER TYPE name OWNER TO { new_owner | CURRENT_ROLE | CURRENT_USER | SESSION_USER }
 * ALTER TYPE name RENAME TO new_name
 * ALTER TYPE name SET SCHEMA new_schema
 * ```
 */

/**
 * ALTER TYPE ... OWNER TO ...
 */
export class AlterRangeChangeOwner extends Change {
  public readonly main: Range;
  public readonly branch: Range;
  public readonly operation = "alter" as const;
  public readonly scope = "object" as const;
  public readonly objectType = "range" as const;

  constructor(props: { main: Range; branch: Range }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get dependencies() {
    return [this.main.stableId];
  }

  serialize(): string {
    return [
      "ALTER TYPE",
      `${this.main.schema}.${this.main.name}`,
      "OWNER TO",
      this.branch.owner,
    ].join(" ");
  }
}

/**
 * Replace a range type by dropping and recreating it.
 * This is used when properties that cannot be altered via ALTER TYPE change.
 */
// NOTE: ReplaceRange removed. Non-alterable changes are emitted as Drop + Create in range.diff.ts.
