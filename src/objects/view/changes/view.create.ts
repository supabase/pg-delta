import { CreateChange, quoteIdentifier } from "../../base.change.ts";
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
export class CreateView extends CreateChange {
  public readonly view: View;

  constructor(props: { view: View }) {
    super();
    this.view = props.view;
  }

  serialize(): string {
    const parts: string[] = ["CREATE OR REPLACE VIEW"];

    // Add schema and name
    parts.push(
      `${quoteIdentifier(this.view.schema)}.${quoteIdentifier(this.view.name)}`,
    );

    // Add WITH options if specified
    if (this.view.options && this.view.options.length > 0) {
      parts.push("WITH", `(${this.view.options.join(", ")})`);
    }

    // Add AS query
    if (this.view.definition) {
      parts.push("AS", this.view.definition);
    } else {
      parts.push("AS SELECT 1"); // Placeholder
    }

    return parts.join(" ");
  }
}
