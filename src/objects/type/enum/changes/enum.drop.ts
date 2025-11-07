import type { Enum } from "../enum.model.ts";
import { DropEnumChange } from "./enum.base.ts";

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
export class DropEnum extends DropEnumChange {
  public readonly enum: Enum;
  public readonly scope = "object" as const;

  constructor(props: { enum: Enum }) {
    super();
    this.enum = props.enum;
  }

  get drops() {
    return [this.enum.stableId];
  }

  get requires() {
    return [this.enum.stableId];
  }

  serialize(): string {
    return ["DROP TYPE", `${this.enum.schema}.${this.enum.name}`].join(" ");
  }
}
