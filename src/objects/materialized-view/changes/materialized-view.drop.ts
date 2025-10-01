import { Change } from "../../base.change.ts";
import type { MaterializedView } from "../materialized-view.model.ts";

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
export class DropMaterializedView extends Change {
  public readonly materializedView: MaterializedView;
  public readonly operation = "drop" as const;
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
    return [
      "DROP MATERIALIZED VIEW",
      `${this.materializedView.schema}.${this.materializedView.name}`,
    ].join(" ");
  }
}
