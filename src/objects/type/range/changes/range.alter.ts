import type { Range } from "../range.model.ts";
import { AlterRangeChange } from "./range.base.ts";

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

export type AlterRange = AlterRangeChangeOwner;

/**
 * ALTER TYPE ... OWNER TO ...
 */
export class AlterRangeChangeOwner extends AlterRangeChange {
  public readonly range: Range;
  public readonly owner: string;
  public readonly scope = "object" as const;

  constructor(props: { range: Range; owner: string }) {
    super();
    this.range = props.range;
    this.owner = props.owner;
  }

  get requires() {
    return [this.range.stableId];
  }

  serialize(): string {
    return [
      "ALTER TYPE",
      `${this.range.schema}.${this.range.name}`,
      "OWNER TO",
      this.owner,
    ].join(" ");
  }
}

/**
 * Replace a range type by dropping and recreating it.
 * This is used when properties that cannot be altered via ALTER TYPE change.
 */
// NOTE: ReplaceRange removed. Non-alterable changes are emitted as Drop + Create in range.diff.ts.
