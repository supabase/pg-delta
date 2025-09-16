import { DropChange } from "../../../base.change.ts";
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

  get dependencies() {
    return [this.enum.stableId];
  }

  serialize(): string {
    return ["DROP TYPE", `${this.enum.schema}.${this.enum.name}`].join(" ");
  }
}
