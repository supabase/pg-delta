import { Change } from "../../base.change.ts";
import type { View } from "../view.model.ts";

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
export class AlterViewChangeOwner extends Change {
  public readonly main: View;
  public readonly branch: View;
  public readonly operation = "alter" as const;
  public readonly scope = "object" as const;
  public readonly objectType = "view" as const;

  constructor(props: { main: View; branch: View }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get dependencies() {
    return [this.main.stableId];
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

// NOTE: ReplaceView removed. Non-alterable changes are emitted as CREATE OR REPLACE in view.diff.ts.

/**
 * ALTER VIEW ... SET ( ... )
 */
export class AlterViewSetOptions extends Change {
  public readonly main: View;
  public readonly branch: View;
  public readonly operation = "alter" as const;
  public readonly scope = "object" as const;
  public readonly objectType = "view" as const;

  constructor(props: { main: View; branch: View }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get dependencies() {
    return [this.main.stableId];
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
export class AlterViewResetOptions extends Change {
  public readonly view: View;
  public readonly params: string[];
  public readonly operation = "alter" as const;
  public readonly scope = "object" as const;
  public readonly objectType = "view" as const;

  constructor(props: { view: View; params: string[] }) {
    super();
    this.view = props.view;
    this.params = props.params;
  }

  get dependencies() {
    return [this.view.stableId];
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
