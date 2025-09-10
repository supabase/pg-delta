import { DropChange } from "../../base.change.ts";
import type { Sequence } from "../sequence.model.ts";

/**
 * Drop a sequence.
 *
 * @see https://www.postgresql.org/docs/17/sql-dropsequence.html
 *
 * Synopsis
 * ```sql
 * DROP SEQUENCE [ IF EXISTS ] name [, ...] [ CASCADE | RESTRICT ]
 * ```
 */
export class DropSequence extends DropChange {
  public readonly sequence: Sequence;

  constructor(props: { sequence: Sequence }) {
    super();
    this.sequence = props.sequence;
  }

  get stableId(): string {
    return `${this.sequence.stableId}`;
  }

  serialize(): string {
    return [
      "DROP SEQUENCE",
      `${this.sequence.schema}.${this.sequence.name}`,
    ].join(" ");
  }
}
