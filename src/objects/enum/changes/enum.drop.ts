import { DropChange, quoteIdentifier } from "../../base.change.ts";
import type { Enum } from "../enum.model.ts";

/**
 * Drop an enum.
 *
 * @see https://www.postgresql.org/docs/17/sql-droptype.html
 *
 * Synopsis
 * ```sql
 * DROP TYPE [ IF EXISTS ] name [, ...] [ CASCADE | RESTRICT ]
 * ```
 */
export class DropEnum extends DropChange {
  public readonly enum: Enum;

  constructor(props: { enum: Enum }) {
    super();
    this.enum = props.enum;
  }

  serialize(): string {
    return [
      "DROP TYPE",
      `${quoteIdentifier(this.enum.schema)}.${quoteIdentifier(this.enum.name)}`,
    ].join(" ");
  }
}
