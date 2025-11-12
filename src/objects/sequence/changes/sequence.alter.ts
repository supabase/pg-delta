import type { Sequence } from "../sequence.model.ts";
import { AlterSequenceChange } from "./sequence.base.ts";

/**
 * Alter a sequence.
 *
 * @see https://www.postgresql.org/docs/17/sql-altersequence.html
 *
 * Synopsis
 * ```sql
 * ALTER SEQUENCE [ IF EXISTS ] name [ INCREMENT [ BY ] increment ]
 *     [ MINVALUE minvalue | NO MINVALUE ] [ MAXVALUE maxvalue | NO MAXVALUE ]
 *     [ START [ WITH ] start ] [ RESTART [ [ WITH ] restart ] ]
 *     [ CACHE cache ] [ [ NO ] CYCLE ] [ OWNED BY { table_name.column_name | NONE } ]
 * ```
 */

export type AlterSequence = AlterSequenceSetOptions | AlterSequenceSetOwnedBy;

/**
 * ALTER SEQUENCE ... OWNED BY ... | OWNED BY NONE
 */
export class AlterSequenceSetOwnedBy extends AlterSequenceChange {
  public readonly sequence: Sequence;
  public readonly ownedBy: {
    schema: string;
    table: string;
    column: string;
  } | null;
  public readonly scope = "object" as const;

  constructor(props: {
    sequence: Sequence;
    ownedBy: { schema: string; table: string; column: string } | null;
  }) {
    super();
    this.sequence = props.sequence;
    this.ownedBy = props.ownedBy;
  }

  get creates() {
    return [];
  }

  get requires() {
    return [
      this.sequence.stableId,
      ...(this.ownedBy
        ? [
            `column:${this.ownedBy.schema}.${this.ownedBy.table}.${this.ownedBy.column}`,
          ]
        : []),
    ];
  }

  serialize(): string {
    const head = [
      "ALTER SEQUENCE",
      `${this.sequence.schema}.${this.sequence.name}`,
    ];
    if (this.ownedBy) {
      return [
        ...head,
        "OWNED BY",
        `${this.ownedBy.schema}.${this.ownedBy.table}.${this.ownedBy.column}`,
      ].join(" ");
    }
    return [...head, "OWNED BY NONE"].join(" ");
  }
}

/**
 * ALTER SEQUENCE ... set options ...
 * Emits only changed options, in a stable order.
 */
export class AlterSequenceSetOptions extends AlterSequenceChange {
  public readonly sequence: Sequence;
  public readonly options: string[];
  public readonly scope = "object" as const;

  constructor(props: { sequence: Sequence; options: string[] }) {
    super();
    this.sequence = props.sequence;
    this.options = props.options;
  }

  get creates() {
    return [];
  }

  get requires() {
    return [this.sequence.stableId];
  }

  // Note: default max computation moved to diff when building options

  serialize(): string {
    const parts: string[] = [
      "ALTER SEQUENCE",
      `${this.sequence.schema}.${this.sequence.name}`,
    ];
    return [...parts, ...this.options].join(" ");
  }
}

/**
 * Replace a sequence by dropping and recreating it.
 * This is used when properties that cannot be altered via ALTER SEQUENCE change.
 */
// NOTE: ReplaceSequence removed. Non-alterable changes are emitted as Drop + Create in sequence.diff.ts.
