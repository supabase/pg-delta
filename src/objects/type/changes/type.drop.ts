import { DropChange, quoteIdentifier } from "../../base.change.ts";
import type { Type } from "../type.model.ts";

/**
 * Drop a type.
 *
 * @see https://www.postgresql.org/docs/17/sql-droptype.html
 *
 * Synopsis
 * ```sql
 * DROP TYPE [ IF EXISTS ] name [, ...] [ CASCADE | RESTRICT ]
 * ```
 */
export class DropType extends DropChange {
  public readonly type: Type;

  constructor(props: { type: Type }) {
    super();
    this.type = props.type;
  }

  serialize(): string {
    return [
      "DROP TYPE",
      `${quoteIdentifier(this.type.schema)}.${quoteIdentifier(this.type.name)}`,
    ].join(" ");
  }
}
