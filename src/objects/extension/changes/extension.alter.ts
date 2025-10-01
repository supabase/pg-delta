import { Change, quoteLiteral } from "../../base.change.ts";
import type { Extension } from "../extension.model.ts";

/**
 * Alter an extension.
 *
 * @see https://www.postgresql.org/docs/17/sql-alterextension.html
 *
 * Synopsis
 * ```sql
 * ALTER EXTENSION name UPDATE [ TO new_version ]
 * ALTER EXTENSION name SET SCHEMA new_schema
 * ALTER EXTENSION name ADD member_object
 * ALTER EXTENSION name DROP member_object
 * ```
 */

/**
 * ALTER EXTENSION ... UPDATE TO ...
 */
export class AlterExtensionUpdateVersion extends Change {
  public readonly main: Extension;
  public readonly branch: Extension;
  public readonly operation = "alter" as const;
  public readonly scope = "object" as const;
  public readonly objectType = "extension" as const;

  constructor(props: { main: Extension; branch: Extension }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get dependencies() {
    return [this.main.stableId];
  }

  serialize(): string {
    return [
      "ALTER EXTENSION",
      this.main.name,
      "UPDATE TO",
      quoteLiteral(this.branch.version),
    ].join(" ");
  }
}

/**
 * ALTER EXTENSION ... SET SCHEMA ...
 */
export class AlterExtensionSetSchema extends Change {
  public readonly main: Extension;
  public readonly branch: Extension;
  public readonly operation = "alter" as const;
  public readonly scope = "object" as const;
  public readonly objectType = "extension" as const;

  constructor(props: { main: Extension; branch: Extension }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get dependencies() {
    return [this.main.stableId];
  }

  serialize(): string {
    return [
      "ALTER EXTENSION",
      this.main.name,
      "SET SCHEMA",
      this.branch.schema,
    ].join(" ");
  }
}

/**
 * ALTER EXTENSION ... OWNER TO ...
 */
export class AlterExtensionChangeOwner extends Change {
  public readonly main: Extension;
  public readonly branch: Extension;
  public readonly operation = "alter" as const;
  public readonly scope = "object" as const;
  public readonly objectType = "extension" as const;

  constructor(props: { main: Extension; branch: Extension }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get dependencies() {
    return [this.main.stableId];
  }

  serialize(): string {
    return [
      "ALTER EXTENSION",
      this.main.name,
      "OWNER TO",
      this.branch.owner,
    ].join(" ");
  }
}
