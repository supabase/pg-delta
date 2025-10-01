import { Change, quoteLiteral } from "../../../base.change.ts";
import type { Enum } from "../enum.model.ts";

/**
 * Alter an enum.
 *
 * @see https://www.postgresql.org/docs/17/sql-altertype.html
 *
 * Synopsis
 * ```sql
 * ALTER TYPE name OWNER TO { new_owner | CURRENT_ROLE | CURRENT_USER | SESSION_USER }
 * ALTER TYPE name RENAME TO new_name
 * ALTER TYPE name ADD VALUE [ IF NOT EXISTS ] new_enum_value [ { BEFORE | AFTER } neighbor_enum_value ]
 * ALTER TYPE name RENAME VALUE existing_enum_value TO new_enum_value
 * ```
 */

/**
 * ALTER TYPE ... OWNER TO ...
 */
export class AlterEnumChangeOwner extends Change {
  public readonly main: Enum;
  public readonly branch: Enum;
  public readonly operation = "alter" as const;
  public readonly scope = "object" as const;
  public readonly objectType = "enum" as const;

  constructor(props: { main: Enum; branch: Enum }) {
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
 * ALTER TYPE ... ADD VALUE ...
 */
export class AlterEnumAddValue extends Change {
  public readonly main: Enum;
  public readonly branch: Enum;
  public readonly newValue: string;
  public readonly position?: { before?: string; after?: string };
  public readonly operation = "alter" as const;
  public readonly scope = "object" as const;
  public readonly objectType = "enum" as const;

  constructor(props: {
    main: Enum;
    branch: Enum;
    newValue: string;
    position?: { before?: string; after?: string };
  }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
    this.newValue = props.newValue;
    this.position = props.position;
  }

  get dependencies() {
    return [this.main.stableId];
  }

  serialize(): string {
    const parts = [
      "ALTER TYPE",
      `${this.main.schema}.${this.main.name}`,
      "ADD VALUE",
      quoteLiteral(this.newValue),
    ];

    if (this.position?.before) {
      parts.push("BEFORE", quoteLiteral(this.position.before));
    } else if (this.position?.after) {
      parts.push("AFTER", quoteLiteral(this.position.after));
    }

    return parts.join(" ");
  }
}

// NOTE: ReplaceEnum removed. Complex enum changes should be handled in diff with Drop + Create when needed.
