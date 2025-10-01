import { Change } from "../../base.change.ts";
import type { View } from "../view.model.ts";

/**
 * Create a view.
 *
 * @see https://www.postgresql.org/docs/17/sql-createview.html
 *
 * Synopsis
 * ```sql
 * CREATE [ OR REPLACE ] [ TEMP | TEMPORARY ] [ RECURSIVE ] VIEW name [ ( column_name [, ...] ) ]
 *     [ WITH ( view_option_name [= view_option_value] [, ... ] ) ]
 *     AS query
 *     [ WITH [ CASCADE | LOCAL ] CHECK OPTION ]
 * ```
 */
export class CreateView extends Change {
  public readonly view: View;
  public readonly orReplace?: boolean;
  public readonly operation = "create" as const;
  public readonly scope = "object" as const;
  public readonly objectType = "view" as const;

  constructor(props: { view: View; orReplace?: boolean }) {
    super();
    this.view = props.view;
    this.orReplace = props.orReplace;
  }

  get dependencies() {
    return [this.view.stableId];
  }

  serialize(): string {
    const parts: string[] = [
      `CREATE${this.orReplace ? " OR REPLACE" : ""} VIEW`,
    ];

    // Add schema and name
    parts.push(`${this.view.schema}.${this.view.name}`);

    // Add WITH options if specified
    if (this.view.options && this.view.options.length > 0) {
      parts.push("WITH", `(${this.view.options.join(", ")})`);
    }

    // Add AS query (trim to avoid double spaces before SELECT)
    parts.push("AS", this.view.definition.trim());

    return parts.join(" ");
  }
}
