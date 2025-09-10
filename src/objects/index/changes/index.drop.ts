import { DropChange } from "../../base.change.ts";
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
export class DropIndex extends DropChange {
  public readonly index: Index;

  constructor(props: { index: Index }) {
    super();
    this.index = props.index;
  }

  get stableId(): string {
    return `${this.index.stableId}`;
  }

  serialize(): string {
    return ["DROP INDEX", `${this.index.schema}.${this.index.name}`].join(" ");
  }
}
