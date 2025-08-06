import {
  AlterChange,
  quoteIdentifier,
  ReplaceChange,
} from "../../base.change.ts";
import type { CompositeType } from "../composite-type.model.ts";
import { CreateCompositeType } from "./composite-type.create.ts";
import { DropCompositeType } from "./composite-type.drop.ts";

/**
 * Alter a composite type.
 *
 * @see https://www.postgresql.org/docs/17/sql-altertype.html
 *
 * Synopsis
 * ```sql
 * ALTER TYPE name OWNER TO { new_owner | CURRENT_ROLE | CURRENT_USER | SESSION_USER }
 * ALTER TYPE name RENAME TO new_name
 * ALTER TYPE name RENAME ATTRIBUTE attribute_name TO new_attribute_name
 * ALTER TYPE name SET SCHEMA new_schema
 * ```
 */
export type AlterCompositeType = AlterCompositeTypeChangeOwner;

/**
 * ALTER TYPE ... OWNER TO ...
 */
export class AlterCompositeTypeChangeOwner extends AlterChange {
  public readonly main: CompositeType;
  public readonly branch: CompositeType;

  constructor(props: { main: CompositeType; branch: CompositeType }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
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
 * Replace a composite type by dropping and recreating it.
 * This is used when properties that cannot be altered via ALTER TYPE change.
 */
export class ReplaceCompositeType extends ReplaceChange {
  public readonly main: CompositeType;
  public readonly branch: CompositeType;

  constructor(props: { main: CompositeType; branch: CompositeType }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  serialize(): string {
    const dropChange = new DropCompositeType({ compositeType: this.main });
    const createChange = new CreateCompositeType({
      compositeType: this.branch,
    });

    return [dropChange.serialize(), createChange.serialize()].join(";\n");
  }
}
