import { DropChange } from "../../base.change.ts";
import type { Collation } from "../collation.model.ts";

/**
 * Drop a collation.
 *
 * @see https://www.postgresql.org/docs/17/sql-dropcollation.html
 *
 * Synopsis
 * ```sql
 * DROP COLLATION [ IF EXISTS ] name [ CASCADE | RESTRICT ]
 * ```
 */
export class DropCollation extends DropChange {
  public readonly collation: Collation;

  constructor(props: { collation: Collation }) {
    super();
    this.collation = props.collation;
  }

  get stableId(): string {
    return `${this.collation.stableId}`;
  }

  serialize(): string {
    return [
      "DROP COLLATION",
      `${this.collation.schema}.${this.collation.name}`,
    ].join(" ");
  }
}
