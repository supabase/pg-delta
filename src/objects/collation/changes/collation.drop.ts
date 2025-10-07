import type { Collation } from "../collation.model.ts";
import { DropCollationChange } from "./collation.base.ts";

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
export class DropCollation extends DropCollationChange {
  public readonly collation: Collation;
  public readonly scope = "object" as const;

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
