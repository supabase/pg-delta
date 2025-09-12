import { AlterChange, ReplaceChange } from "../../base.change.ts";
import type { Collation } from "../collation.model.ts";
import { CreateCollation } from "./collation.create.ts";
import { DropCollation } from "./collation.drop.ts";

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
export class AlterCollationChangeOwner extends AlterChange {
  public readonly main: Collation;
  public readonly branch: Collation;

  constructor(props: { main: Collation; branch: Collation }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get dependencies() {
    return [`${this.main.stableId}`, `role:${this.branch.owner}`];
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
export class AlterCollationRefreshVersion extends AlterChange {
  public readonly main: Collation;
  public readonly branch: Collation;

  constructor(props: { main: Collation; branch: Collation }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get dependencies() {
    return [`${this.main.stableId}`];
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
export class ReplaceCollation extends ReplaceChange {
  public readonly main: Collation;
  public readonly branch: Collation;

  constructor(props: { main: Collation; branch: Collation }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get dependencies() {
    return [`${this.main.stableId}`];
  }

  serialize(): string {
    const dropChange = new DropCollation({ collation: this.main });
    const createChange = new CreateCollation({ collation: this.branch });

    return [dropChange.serialize(), createChange.serialize()].join(";\n");
  }
}
