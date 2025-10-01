import { Change } from "../../base.change.ts";
import type { Index } from "../index.model.ts";

/**
 * Drop an index.
 *
 * @see https://www.postgresql.org/docs/17/sql-dropindex.html
 *
 * Synopsis
 * ```sql
 * DROP INDEX [ CONCURRENTLY ] [ IF EXISTS ] name [, ...] [ CASCADE | RESTRICT ]
 * ```
 */
export class DropIndex extends Change {
  public readonly index: Index;
  public readonly operation = "drop" as const;
  public readonly scope = "object" as const;
  public readonly objectType = "index" as const;

  constructor(props: { index: Index }) {
    super();
    this.index = props.index;
  }

  get dependencies() {
    return [this.index.stableId];
  }

  serialize(): string {
    return ["DROP INDEX", `${this.index.schema}.${this.index.name}`].join(" ");
  }
}
