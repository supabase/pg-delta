import { Change } from "../../base.change.ts";
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
export class DropCollation extends Change {
  public readonly collation: Collation;
  public readonly operation = "drop" as const;
  public readonly scope = "object" as const;
  public readonly objectType = "collation" as const;

  constructor(props: { collation: Collation }) {
    super();
    this.collation = props.collation;
  }

  get dependencies() {
    return [this.collation.stableId];
  }

  serialize(): string {
    return [
      "DROP COLLATION",
      `${this.collation.schema}.${this.collation.name}`,
    ].join(" ");
  }
}
