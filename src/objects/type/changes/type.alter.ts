import {
  AlterChange,
  quoteIdentifier,
  ReplaceChange,
} from "../../base.change.ts";
import type { Type } from "../type.model.ts";
import { CreateType } from "./type.create.ts";
import { DropType } from "./type.drop.ts";

/**
 * Alter a type.
 *
 * @see https://www.postgresql.org/docs/17/sql-altertype.html
 *
 * Synopsis
 * ```sql
 * ALTER TYPE name OWNER TO { new_owner | CURRENT_ROLE | CURRENT_USER | SESSION_USER }
 * ALTER TYPE name RENAME TO new_name
 * ALTER TYPE name SET SCHEMA new_schema
 * ALTER TYPE name ADD VALUE [ IF NOT EXISTS ] new_enum_value [ { BEFORE | AFTER } neighbor_enum_value ]
 * ALTER TYPE name RENAME VALUE existing_enum_value TO new_enum_value
 * ```
 */
export type AlterType = AlterTypeChangeOwner;

/**
 * ALTER TYPE ... OWNER TO ...
 */
export class AlterTypeChangeOwner extends AlterChange {
  public readonly main: Type;
  public readonly branch: Type;

  constructor(props: { main: Type; branch: Type }) {
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
      `${quoteIdentifier(this.main.schema)}.${quoteIdentifier(this.main.name)}`,
      "OWNER TO",
      quoteIdentifier(this.branch.owner),
    ].join(" ");
  }
}

/**
 * Replace a type by dropping and recreating it.
 * This is used when properties that cannot be altered via ALTER TYPE change.
 */
export class ReplaceType extends ReplaceChange {
  public readonly main: Type;
  public readonly branch: Type;

  constructor(props: { main: Type; branch: Type }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get stableId(): string {
    return `${this.main.stableId}`;
  }

  serialize(): string {
    const dropChange = new DropType({ type: this.main });
    const createChange = new CreateType({ type: this.branch });

    return [dropChange.serialize(), createChange.serialize()].join(";\n");
  }
}
