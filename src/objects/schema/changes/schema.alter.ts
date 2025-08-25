import {
  AlterChange,
  quoteIdentifier,
  ReplaceChange,
} from "../../base.change.ts";
import type { Schema } from "../schema.model.ts";
import { CreateSchema } from "./schema.create.ts";
import { DropSchema } from "./schema.drop.ts";

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
export type AlterSchema = AlterSchemaChangeOwner;

/**
 * ALTER SCHEMA ... OWNER TO ...
 */
export class AlterSchemaChangeOwner extends AlterChange {
  public readonly main: Schema;
  public readonly branch: Schema;

  constructor(props: { main: Schema; branch: Schema }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get stableId(): string {
    return `${this.main.stableId}`;
  }

  serialize(): string {
    return [
      "ALTER SCHEMA",
      quoteIdentifier(this.main.schema),
      "OWNER TO",
      quoteIdentifier(this.branch.owner),
    ].join(" ");
  }
}

/**
 * Replace a schema by dropping and recreating it.
 * This is used when properties that cannot be altered via ALTER SCHEMA change.
 */
export class ReplaceSchema extends ReplaceChange {
  public readonly main: Schema;
  public readonly branch: Schema;

  constructor(props: { main: Schema; branch: Schema }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get stableId(): string {
    return `${this.main.stableId}`;
  }

  serialize(): string {
    const dropChange = new DropSchema({ schema: this.main });
    const createChange = new CreateSchema({ schema: this.branch });

    return [dropChange.serialize(), createChange.serialize()].join(";\n");
  }
}
