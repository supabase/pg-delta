import { DropChange, quoteIdentifier } from "../../base.change.ts";
import type { Procedure } from "../procedure.model.ts";
import { formatFunctionArguments } from "../utils.ts";

/**
 * Drop a procedure.
 *
 * @see https://www.postgresql.org/docs/17/sql-dropfunction.html
 *
 * Synopsis
 * ```sql
 * DROP FUNCTION [ IF EXISTS ] name ( [ [ argmode ] [ argname ] argtype [, ...] ] ) [, ...] [ CASCADE | RESTRICT ]
 * DROP PROCEDURE [ IF EXISTS ] name ( [ [ argmode ] [ argname ] argtype [, ...] ] ) [, ...] [ CASCADE | RESTRICT ]
 * ```
 */
export class DropProcedure extends DropChange {
  public readonly procedure: Procedure;

  constructor(props: { procedure: Procedure }) {
    super();
    this.procedure = props.procedure;
  }

  get stableId(): string {
    return `${this.procedure.stableId}`;
  }

  serialize(): string {
    const objectType = this.procedure.kind === "p" ? "PROCEDURE" : "FUNCTION";

    // Build argument list
    const args = formatFunctionArguments(
      this.procedure.argument_names,
      this.procedure.argument_types,
      this.procedure.argument_modes,
    );

    return [
      "DROP",
      objectType,
      `${quoteIdentifier(this.procedure.schema)}.${quoteIdentifier(this.procedure.name)}(${args})`,
    ].join(" ");
  }
}
