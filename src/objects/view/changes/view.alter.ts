import {
  AlterChange,
  quoteIdentifier,
  ReplaceChange,
} from "../../base.change.ts";
import type { View } from "../view.model.ts";
import { CreateView } from "./view.create.ts";
import { DropView } from "./view.drop.ts";

/**
 * Alter a view.
 *
 * @see https://www.postgresql.org/docs/17/sql-alterview.html
 *
 * Synopsis
 * ```sql
 * ALTER VIEW [ IF EXISTS ] name ALTER [ COLUMN ] column_name SET DEFAULT expression
 * ALTER VIEW [ IF EXISTS ] name ALTER [ COLUMN ] column_name DROP DEFAULT
 * ALTER VIEW [ IF EXISTS ] name OWNER TO { new_owner | CURRENT_ROLE | CURRENT_USER | SESSION_USER }
 * ALTER VIEW [ IF EXISTS ] name RENAME TO new_name
 * ALTER VIEW [ IF EXISTS ] name SET SCHEMA new_schema
 * ```
 */
export type AlterView = AlterViewChangeOwner;

/**
 * ALTER VIEW ... OWNER TO ...
 */
export class AlterViewChangeOwner extends AlterChange {
  public readonly main: View;
  public readonly branch: View;

  constructor(props: { main: View; branch: View }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  serialize(): string {
    return [
      "ALTER VIEW",
      `${quoteIdentifier(this.main.schema)}.${quoteIdentifier(this.main.name)}`,
      "OWNER TO",
      quoteIdentifier(this.branch.owner),
    ].join(" ");
  }
}

/**
 * Replace a view by dropping and recreating it.
 * This is used when properties that cannot be altered via ALTER VIEW change.
 */
export class ReplaceView extends ReplaceChange {
  public readonly main: View;
  public readonly branch: View;

  constructor(props: { main: View; branch: View }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  serialize(): string {
    const dropChange = new DropView({ view: this.main });
    const createChange = new CreateView({ view: this.branch });

    return [dropChange.serialize(), createChange.serialize()].join(";\n");
  }
}
