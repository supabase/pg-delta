import { stableId } from "../../utils.ts";
import type { Sequence } from "../sequence.model.ts";
import { CreateSequenceChange } from "./sequence.base.ts";

/**
 * Create a sequence.
 *
 * @see https://www.postgresql.org/docs/17/sql-createsequence.html
 *
 * Synopsis
 * ```sql
 * CREATE [ TEMPORARY | TEMP ] SEQUENCE [ IF NOT EXISTS ] name [ INCREMENT [ BY ] increment ]
 *     [ MINVALUE minvalue | NO MINVALUE ] [ MAXVALUE maxvalue | NO MAXVALUE ]
 *     [ START [ WITH ] start ] [ CACHE cache ] [ [ NO ] CYCLE ]
 *     [ OWNED BY { table_name.column_name | NONE } ]
 * ```
 */
export class CreateSequence extends CreateSequenceChange {
  public readonly sequence: Sequence;
  public readonly scope = "object" as const;

  constructor(props: { sequence: Sequence }) {
    super();
    this.sequence = props.sequence;
  }

  get creates() {
    return [this.sequence.stableId];
  }

  override acceptsDependency(
    dependentId: string,
    referencedId: string,
  ): boolean {
    if (dependentId === this.sequence.stableId) {
      const ownedByIds: string[] = [];
      const {
        owned_by_schema: schema,
        owned_by_table: table,
        owned_by_column: column,
      } = this.sequence;

      if (schema && table) {
        ownedByIds.push(`table:${schema}.${table}`);
        if (column) {
          ownedByIds.push(stableId.column(schema, table, column));
        }
      }

      if (ownedByIds.some((candidateId) => candidateId === referencedId)) {
        return false;
      }
    }

    return super.acceptsDependency(dependentId, referencedId);
  }

  serialize(): string {
    const parts: string[] = ["CREATE SEQUENCE"];

    // Add schema and name
    parts.push(`${this.sequence.schema}.${this.sequence.name}`);

    // Add data type if not default
    if (this.sequence.data_type && this.sequence.data_type !== "bigint") {
      parts.push("AS", this.sequence.data_type);
    }

    // Add INCREMENT
    if (this.sequence.increment !== 1) {
      parts.push("INCREMENT BY", this.sequence.increment.toString());
    }

    // Add MINVALUE if not default (1)
    if (this.sequence.minimum_value !== BigInt(1)) {
      parts.push("MINVALUE", this.sequence.minimum_value.toString());
    }

    // Add MAXVALUE if not default (depends on data type)
    const defaultMaxValue =
      this.sequence.data_type === "integer"
        ? BigInt("2147483647")
        : BigInt("9223372036854775807");
    if (this.sequence.maximum_value !== defaultMaxValue) {
      parts.push("MAXVALUE", this.sequence.maximum_value.toString());
    }

    // Add START
    if (this.sequence.start_value !== 1) {
      parts.push("START WITH", this.sequence.start_value.toString());
    }

    // Add CACHE
    if (this.sequence.cache_size !== 1) {
      parts.push("CACHE", this.sequence.cache_size.toString());
    }

    // Add CYCLE only if true (default is NO CYCLE)
    if (this.sequence.cycle_option) {
      parts.push("CYCLE");
    }

    return parts.join(" ");
  }
}
