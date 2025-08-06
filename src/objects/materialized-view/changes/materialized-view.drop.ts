import { DropChange, quoteIdentifier } from "../../base.change.ts";
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
 */
export class DropMaterializedView extends DropChange {
  public readonly materializedView: MaterializedView;

  constructor(props: { materializedView: MaterializedView }) {
    super();
    this.materializedView = props.materializedView;
  }

  serialize(): string {
    return [
      "DROP MATERIALIZED VIEW",
      `${quoteIdentifier(this.materializedView.schema)}.${quoteIdentifier(this.materializedView.name)}`,
    ].join(" ");
  }
}
