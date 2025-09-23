import { CreateChange, quoteLiteral } from "../../base.change.ts";
import type { Extension } from "../extension.model.ts";
import type { ExtensionChange } from "./extension.base.ts";

/**
 * Create an extension.
 *
 * @see https://www.postgresql.org/docs/17/sql-createextension.html
 *
 * Synopsis
 * ```sql
 * CREATE EXTENSION [ IF NOT EXISTS ] extension_name
 *     [ WITH ] [ SCHEMA schema_name ]
 *     [ VERSION version ]
 *     [ FROM old_version ]
 * ```
 */
export class CreateExtension extends CreateChange implements ExtensionChange {
  public readonly extension: Extension;
  public readonly category = "extension" as const;

  constructor(props: { extension: Extension }) {
    super();
    this.extension = props.extension;
  }

  get dependencies() {
    return [this.extension.stableId];
  }

  serialize(): string {
    const parts: string[] = ["CREATE EXTENSION"];

    // Add extension name
    parts.push(this.extension.name);

    // Add schema
    parts.push("WITH SCHEMA", this.extension.schema);

    // Add version
    if (this.extension.version) {
      parts.push("VERSION", quoteLiteral(this.extension.version));
    }

    return parts.join(" ");
  }
}
