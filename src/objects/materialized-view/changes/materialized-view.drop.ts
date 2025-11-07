import { stableId } from "../../utils.ts";
import type { MaterializedView } from "../materialized-view.model.ts";
import { DropMaterializedViewChange } from "./materialized-view.base.ts";

/**
 * Drop a materialized view.
 *
 * @see https://www.postgresql.org/docs/17/sql-dropmaterializedview.html
 *
 * Synopsis
 * ```sql
 * DROP MATERIALIZED VIEW [ IF EXISTS ] name [, ...] [ CASCADE | RESTRICT ]
 * ```
 *
 * Notes for diff-based generation:
 * - IF EXISTS is omitted for deterministic diffs; the object must exist in the source.
 * - We do not emit CASCADE; dependency ordering ensures safe drops, and RESTRICT is default.
 */
export class DropMaterializedView extends DropMaterializedViewChange {
  public readonly materializedView: MaterializedView;
  public readonly scope = "object" as const;

  constructor(props: { materializedView: MaterializedView }) {
    super();
    this.materializedView = props.materializedView;
  }

  get drops() {
    return [
      this.materializedView.stableId,
      ...this.materializedView.columns.map((column) =>
        stableId.column(
          this.materializedView.schema,
          this.materializedView.name,
          column.name,
        ),
      ),
    ];
  }

  get requires() {
    return [
      this.materializedView.stableId,
      ...this.materializedView.columns.map((column) =>
        stableId.column(
          this.materializedView.schema,
          this.materializedView.name,
          column.name,
        ),
      ),
    ];
  }

  serialize(): string {
    return [
      "DROP MATERIALIZED VIEW",
      `${this.materializedView.schema}.${this.materializedView.name}`,
    ].join(" ");
  }
}
