import type { Extension } from "../extension.model.ts";
import { CreateExtensionChange } from "./extension.base.ts";

/**
 * Create an extension.
 *
 * @see https://www.postgresql.org/docs/17/sql-createextension.html
 *
 * Synopsis
 * ```sql
 * CREATE EXTENSION [ IF NOT EXISTS ] extension_name
 *     [ WITH ] [ SCHEMA schema_name ]
 *              [ VERSION version ]
 *              [ CASCADE ]
 * ```
 */
export class CreateExtension extends CreateExtensionChange {
  public readonly extension: Extension;
  public readonly scope = "object" as const;

  constructor(props: { extension: Extension }) {
    super();
    this.extension = props.extension;
  }

  get creates() {
    return [this.extension.stableId, ...this.extension.members];
  }

  serialize(): string {
    const parts: string[] = ["CREATE EXTENSION"];

    // Add extension name
    parts.push(this.extension.name);

    // Add schema
    parts.push("WITH SCHEMA", this.extension.schema);

    // Add version
    // TODO: Omit version for now as versions can differ between main and branch
    // if (this.extension.version) {
    //   parts.push("VERSION", quoteLiteral(this.extension.version));
    // }

    // TODO: Add CASCADE if the extension has dependencies
    // parts.push("CASCADE");

    return parts.join(" ");
  }
}
