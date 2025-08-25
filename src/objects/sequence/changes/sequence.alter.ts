import {
  AlterChange,
  quoteIdentifier,
  ReplaceChange,
} from "../../base.change.ts";
import type { Sequence } from "../sequence.model.ts";
import { CreateSequence } from "./sequence.create.ts";
import { DropSequence } from "./sequence.drop.ts";

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
export type AlterSequence = AlterSequenceChangeOwner;

/**
 * ALTER SEQUENCE ... OWNER TO ...
 */
export class AlterSequenceChangeOwner extends AlterChange {
  public readonly main: Sequence;
  public readonly branch: Sequence;

  constructor(props: { main: Sequence; branch: Sequence }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get stableId(): string {
    return `${this.main.stableId}`;
  }

  serialize(): string {
    return [
      "ALTER SEQUENCE",
      `${quoteIdentifier(this.main.schema)}.${quoteIdentifier(this.main.name)}`,
      "OWNER TO",
      quoteIdentifier(this.branch.owner),
    ].join(" ");
  }
}

/**
 * Replace a sequence by dropping and recreating it.
 * This is used when properties that cannot be altered via ALTER SEQUENCE change.
 */
export class ReplaceSequence extends ReplaceChange {
  public readonly main: Sequence;
  public readonly branch: Sequence;

  constructor(props: { main: Sequence; branch: Sequence }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  get stableId(): string {
    return `${this.main.stableId}`;
  }

  serialize(): string {
    const dropChange = new DropSequence({ sequence: this.main });
    const createChange = new CreateSequence({ sequence: this.branch });

    return [dropChange.serialize(), createChange.serialize()].join(";\n");
  }
}
