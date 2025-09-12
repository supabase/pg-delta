import { AlterChange, ReplaceChange } from "../../base.change.ts";
import type { View } from "../view.model.ts";
import { CreateView } from "./view.create.ts";

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
 * ALTER VIEW [ IF EXISTS ] name RENAME [ COLUMN ] column_name TO new_column_name
 * ALTER VIEW [ IF EXISTS ] name RENAME TO new_name
 * ALTER VIEW [ IF EXISTS ] name SET SCHEMA new_schema
 * ALTER VIEW [ IF EXISTS ] name SET ( view_option_name [= view_option_value] [, ... ] )
 * ALTER VIEW [ IF EXISTS ] name RESET ( view_option_name [, ... ] )
 * ```
 */

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

  get stableId(): string {
    return `${this.main.stableId}`;
  }

  serialize(): string {
    return [
      "ALTER VIEW",
      `${this.main.schema}.${this.main.name}`,
      "OWNER TO",
      this.branch.owner,
    ].join(" ");
  }
}

/**
 * Replace a view.
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

  get stableId(): string {
    return `${this.main.stableId}`;
  }

  serialize(): string {
    const createChange = new CreateView({ view: this.branch, orReplace: true });

    return createChange.serialize();
  }
}

/**
 * ALTER VIEW ... SET ( ... )
 */
export class AlterViewSetOptions extends AlterChange {
  public readonly main: View;
  public readonly branch: View;

  constructor(props: { main: View; branch: View }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get stableId(): string {
    return `${this.main.stableId}`;
  }

  serialize(): string {
    const opts = (this.branch.options ?? []).join(", ");
    return [
      "ALTER VIEW",
      `${this.main.schema}.${this.main.name}`,
      "SET",
      `(${opts})`,
    ].join(" ");
  }
}

/**
 * ALTER VIEW ... RESET ( ... )
 */
export class AlterViewResetOptions extends AlterChange {
  public readonly view: View;
  public readonly params: string[];

  constructor(props: { view: View; params: string[] }) {
    super();
    this.view = props.view;
    this.params = props.params;
  }

  get stableId(): string {
    return `${this.view.stableId}`;
  }

  serialize(): string {
    return [
      "ALTER VIEW",
      `${this.view.schema}.${this.view.name}`,
      "RESET",
      `(${this.params.join(", ")})`,
    ].join(" ");
  }
}
