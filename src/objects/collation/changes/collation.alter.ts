import { Change } from "../../base.change.ts";
import type { Collation } from "../collation.model.ts";

/**
 * Alter a collation.
 *
 * @see https://www.postgresql.org/docs/17/sql-altercollation.html
 *
 * Synopsis
 * ```sql
 * ALTER COLLATION name REFRESH VERSION
 * ALTER COLLATION name OWNER TO { new_owner | CURRENT_ROLE | CURRENT_USER | SESSION_USER }
 * ALTER COLLATION name RENAME TO new_name
 * ```
 */

/**
 * ALTER COLLATION ... OWNER TO ...
 */
export class AlterCollationChangeOwner extends Change {
  public readonly main: Collation;
  public readonly branch: Collation;
  public readonly operation = "alter" as const;
  public readonly scope = "object" as const;
  public readonly objectType = "collation" as const;

  constructor(props: { main: Collation; branch: Collation }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get dependencies() {
    return [this.main.stableId];
  }

  serialize(): string {
    return [
      "ALTER COLLATION",
      `${this.main.schema}.${this.main.name}`,
      "OWNER TO",
      this.branch.owner,
    ].join(" ");
  }
}

/**
 * ALTER COLLATION ... REFRESH VERSION
 */
export class AlterCollationRefreshVersion extends Change {
  public readonly main: Collation;
  public readonly branch: Collation;
  public readonly operation = "alter" as const;
  public readonly scope = "object" as const;
  public readonly objectType = "collation" as const;

  constructor(props: { main: Collation; branch: Collation }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get dependencies() {
    return [this.main.stableId];
  }

  serialize(): string {
    return [
      "ALTER COLLATION",
      `${this.main.schema}.${this.main.name}`,
      "REFRESH VERSION",
    ].join(" ");
  }
}

/**
 * Replace a collation by dropping and recreating it.
 * This is used when properties that cannot be altered via ALTER COLLATION change.
 */
// NOTE: ReplaceCollation has been removed. Non-alterable property changes
// are modeled as separate DropCollation + CreateCollation changes in collation.diff.ts.
