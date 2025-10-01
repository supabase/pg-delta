import { Change } from "../../../base.change.ts";
import type { Range } from "../range.model.ts";

/**
 * Drop a range type.
 *
 * @see https://www.postgresql.org/docs/17/sql-droptype.html
 *
 * Synopsis
 * ```sql
 * DROP TYPE [ IF EXISTS ] name [, ...] [ CASCADE | RESTRICT ]
 * ```
 */
export class DropRange extends Change {
  public readonly range: Range;
  public readonly operation = "drop" as const;
  public readonly scope = "object" as const;
  public readonly objectType = "range" as const;

  constructor(props: { range: Range }) {
    super();
    this.range = props.range;
  }

  get dependencies() {
    return [`${this.range.stableId}`];
  }

  serialize(): string {
    return ["DROP TYPE", `${this.range.schema}.${this.range.name}`].join(" ");
  }
}
