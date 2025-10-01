import { Change } from "../../base.change.ts";
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
 *
 * Notes for diff-based generation:
 * - IF NOT EXISTS is omitted: diffs are deterministic and explicit.
 * - (column_name, ...) list is derived from the SELECT query; we don't emit it.
 * - TABLESPACE is not currently modeled/extracted and is not emitted.
 * - WITH (options) is emitted only when non-empty.
 * - WITH NO DATA is PostgreSQL's default and is omitted; WITH DATA is emitted only when requested.
 */
export class CreateMaterializedView extends Change {
  public readonly materializedView: MaterializedView;
  public readonly operation = "create" as const;
  public readonly scope = "object" as const;
  public readonly objectType = "materialized_view" as const;

  constructor(props: { materializedView: MaterializedView }) {
    super();
    this.materializedView = props.materializedView;
  }

  get dependencies() {
    return [this.materializedView.stableId];
  }

  serialize(): string {
    const parts: string[] = ["CREATE MATERIALIZED VIEW"];

    // Add schema and name
    parts.push(`${this.materializedView.schema}.${this.materializedView.name}`);

    // Add storage parameters if specified
    if (
      this.materializedView.options &&
      this.materializedView.options.length > 0
    ) {
      parts.push("WITH", `(${this.materializedView.options.join(", ")})`);
    }

    // Add AS query (definition is required)
    parts.push("AS", this.materializedView.definition.trim());

    // Add population clause only when non-default
    // Default in PostgreSQL is WITH NO DATA, so we omit it to keep output minimal
    if (this.materializedView.is_populated) {
      parts.push("WITH DATA");
    }

    return parts.join(" ");
  }
}
