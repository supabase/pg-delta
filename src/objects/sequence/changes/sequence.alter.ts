import { AlterChange, ReplaceChange } from "../../base.change.ts";
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
type AlterSequence = AlterSequenceChangeOwner | AlterSequenceSetOptions;

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
      `${this.main.schema}.${this.main.name}`,
      "OWNER TO",
      this.branch.owner,
    ].join(" ");
  }
}

/**
 * ALTER SEQUENCE ... set options ...
 * Emits only changed options, in a stable order.
 */
export class AlterSequenceSetOptions extends AlterChange {
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

  private computeDefaultMax(type: string): bigint {
    return type === "integer"
      ? BigInt("2147483647")
      : BigInt("9223372036854775807");
  }

  serialize(): string {
    const parts: string[] = [
      "ALTER SEQUENCE",
      `${this.main.schema}.${this.main.name}`,
    ];
    const options: string[] = [];

    // INCREMENT
    if (this.main.increment !== this.branch.increment) {
      options.push("INCREMENT BY", String(this.branch.increment));
    }

    // MINVALUE | NO MINVALUE
    if (this.main.minimum_value !== this.branch.minimum_value) {
      const defaultMin = BigInt(1);
      if (this.branch.minimum_value === defaultMin) {
        options.push("NO MINVALUE");
      } else {
        options.push("MINVALUE", this.branch.minimum_value.toString());
      }
    }

    // MAXVALUE | NO MAXVALUE
    if (this.main.maximum_value !== this.branch.maximum_value) {
      const defaultMax = this.computeDefaultMax(this.branch.data_type);
      if (this.branch.maximum_value === defaultMax) {
        options.push("NO MAXVALUE");
      } else {
        options.push("MAXVALUE", this.branch.maximum_value.toString());
      }
    }

    // START WITH
    if (this.main.start_value !== this.branch.start_value) {
      options.push("START WITH", String(this.branch.start_value));
    }

    // CACHE
    if (this.main.cache_size !== this.branch.cache_size) {
      options.push("CACHE", String(this.branch.cache_size));
    }

    // [ NO ] CYCLE
    if (this.main.cycle_option !== this.branch.cycle_option) {
      options.push(this.branch.cycle_option ? "CYCLE" : "NO CYCLE");
    }

    return [...parts, ...options].join(" ");
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
