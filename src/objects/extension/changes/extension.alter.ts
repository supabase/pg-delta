import { AlterChange, quoteLiteral, ReplaceChange } from "../../base.change.ts";
import type { Extension } from "../extension.model.ts";
import { CreateExtension } from "./extension.create.ts";
import { DropExtension } from "./extension.drop.ts";

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
export class AlterExtensionUpdateVersion extends AlterChange {
  public readonly main: Extension;
  public readonly branch: Extension;

  constructor(props: { main: Extension; branch: Extension }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get stableId(): string {
    return `${this.main.stableId}`;
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
export class AlterExtensionSetSchema extends AlterChange {
  public readonly main: Extension;
  public readonly branch: Extension;

  constructor(props: { main: Extension; branch: Extension }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get stableId(): string {
    return `${this.main.stableId}`;
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
export class AlterExtensionChangeOwner extends AlterChange {
  public readonly main: Extension;
  public readonly branch: Extension;

  constructor(props: { main: Extension; branch: Extension }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get stableId(): string {
    return `${this.main.stableId}`;
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

/**
 * Replace an extension by dropping and recreating it.
 * This is used when properties that cannot be altered via ALTER EXTENSION change.
 */
export class ReplaceExtension extends ReplaceChange {
  public readonly main: Extension;
  public readonly branch: Extension;

  constructor(props: { main: Extension; branch: Extension }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get stableId(): string {
    return `${this.main.stableId}`;
  }

  serialize(): string {
    const dropChange = new DropExtension({ extension: this.main });
    const createChange = new CreateExtension({ extension: this.branch });

    return [dropChange.serialize(), createChange.serialize()].join(";\n");
  }
}
