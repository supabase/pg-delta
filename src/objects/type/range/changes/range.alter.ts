import { AlterChange, ReplaceChange } from "../../../base.change.ts";
import type { Range } from "../range.model.ts";
import { CreateRange } from "./range.create.ts";
import { DropRange } from "./range.drop.ts";

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
export class AlterRangeChangeOwner extends AlterChange {
  public readonly main: Range;
  public readonly branch: Range;

  constructor(props: { main: Range; branch: Range }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get stableId(): string {
    return `${this.main.stableId}`;
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
export class ReplaceRange extends ReplaceChange {
  public readonly main: Range;
  public readonly branch: Range;

  constructor(props: { main: Range; branch: Range }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get stableId(): string {
    return `${this.main.stableId}`;
  }

  serialize(): string {
    const dropChange = new DropRange({ range: this.main });
    const createChange = new CreateRange({ range: this.branch });
    return [dropChange.serialize(), createChange.serialize()].join(";\n");
  }
}
