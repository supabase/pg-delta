import { CreateChange, quoteIdentifier } from "../../base.change.ts";
import type { MaterializedView } from "../materialized-view.model.ts";

/**
 * Create a materialized view.
 *
 * @see https://www.postgresql.org/docs/17/sql-creatematerializedview.html
 *
 * Synopsis
 * ```sql
 * CREATE MATERIALIZED VIEW [ IF NOT EXISTS ] table_name
 *     [ (column_name [, ...] ) ]
 *     [ WITH ( storage_parameter [= value] [, ... ] ) ]
 *     [ TABLESPACE tablespace_name ]
 *     AS query
 *     [ WITH [ NO ] DATA ]
 * ```
 */
export class CreateMaterializedView extends CreateChange {
  public readonly materializedView: MaterializedView;

  constructor(props: { materializedView: MaterializedView }) {
    super();
    this.materializedView = props.materializedView;
  }

  serialize(): string {
    const parts: string[] = ["CREATE MATERIALIZED VIEW"];

    // Add schema and name
    parts.push(
      `${quoteIdentifier(this.materializedView.schema)}.${quoteIdentifier(this.materializedView.name)}`,
    );

    // Add storage parameters if specified
    if (
      this.materializedView.options &&
      this.materializedView.options.length > 0
    ) {
      parts.push("WITH", `(${this.materializedView.options.join(", ")})`);
    }

    // Add AS query
    if (this.materializedView.definition) {
      parts.push("AS", this.materializedView.definition);
    } else {
      parts.push("AS SELECT 1"); // Placeholder
    }

    // Add WITH DATA or WITH NO DATA
    if (this.materializedView.is_populated) {
      parts.push("WITH DATA");
    } else {
      parts.push("WITH NO DATA");
    }

    return parts.join(" ");
  }
}
