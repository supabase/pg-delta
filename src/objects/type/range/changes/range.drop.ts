import type { Range } from "../range.model.ts";
import { DropRangeChange } from "./range.base.ts";

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
export class DropRange extends DropRangeChange {
  public readonly range: Range;
  public readonly scope = "object" as const;

  constructor(props: { range: Range }) {
    super();
    this.range = props.range;
  }

  get drops() {
    return [this.range.stableId];
  }

  get requires() {
    return [this.range.stableId];
  }

  serialize(): string {
    return ["DROP TYPE", `${this.range.schema}.${this.range.name}`].join(" ");
  }
}
