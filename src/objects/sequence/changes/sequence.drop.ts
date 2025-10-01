import { Change } from "../../base.change.ts";
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
export class DropSequence extends Change {
  public readonly sequence: Sequence;
  public readonly operation = "drop" as const;
  public readonly scope = "object" as const;
  public readonly objectType = "sequence" as const;

  constructor(props: { sequence: Sequence }) {
    super();
    this.sequence = props.sequence;
  }

  get dependencies() {
    return [this.sequence.stableId];
  }

  serialize(): string {
    return [
      "DROP SEQUENCE",
      `${this.sequence.schema}.${this.sequence.name}`,
    ].join(" ");
  }
}
