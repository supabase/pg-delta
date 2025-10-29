import { stableId } from "../../utils.ts";
import type { Sequence } from "../sequence.model.ts";
import { DropSequenceChange } from "./sequence.base.ts";

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
export class DropSequence extends DropSequenceChange {
  public readonly sequence: Sequence;
  public readonly scope = "object" as const;

  constructor(props: { sequence: Sequence }) {
    super();
    this.sequence = props.sequence;
  }

  get drops() {
    return [this.sequence.stableId];
  }

  get requires() {
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
    return [
      "DROP SEQUENCE",
      `${this.sequence.schema}.${this.sequence.name}`,
    ].join(" ");
  }
}
