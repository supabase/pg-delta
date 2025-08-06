import {
  AlterChange,
  quoteIdentifier,
  ReplaceChange,
} from "../../base.change.ts";
import type { Procedure } from "../procedure.model.ts";
import { CreateProcedure } from "./procedure.create.ts";
import { DropProcedure } from "./procedure.drop.ts";

/**
 * Alter a procedure.
 *
 * @see https://www.postgresql.org/docs/17/sql-alterfunction.html
 *
 * Synopsis
 * ```sql
 * ALTER FUNCTION name ( [ [ argmode ] [ argname ] argtype [, ...] ] )
 *     action [, ... ] [ RESTRICT ]
 * ALTER PROCEDURE name ( [ [ argmode ] [ argname ] argtype [, ...] ] )
 *     action [, ... ] [ RESTRICT ]
 * where action is one of:
 *     [ EXTERNAL ] SECURITY INVOKER | [ EXTERNAL ] SECURITY DEFINER
 *     SET configuration_parameter { TO | = } { value | DEFAULT }
 *     SET configuration_parameter FROM CURRENT
 *     RESET configuration_parameter
 *     RESET ALL
 *     [ EXTERNAL ] SECURITY INVOKER | [ EXTERNAL ] SECURITY DEFINER
 *     SET configuration_parameter { TO | = } { value | DEFAULT }
 *     SET configuration_parameter FROM CURRENT
 *     RESET configuration_parameter
 *     RESET ALL
 * ```
 */
export type AlterProcedure = AlterProcedureChangeOwner;

/**
 * ALTER FUNCTION/PROCEDURE ... OWNER TO ...
 */
export class AlterProcedureChangeOwner extends AlterChange {
  public readonly main: Procedure;
  public readonly branch: Procedure;

  constructor(props: { main: Procedure; branch: Procedure }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  serialize(): string {
    const objectType = this.main.kind === "p" ? "PROCEDURE" : "FUNCTION";

    return [
      "ALTER",
      objectType,
      `${quoteIdentifier(this.main.schema)}.${quoteIdentifier(this.main.name)}`,
      "OWNER TO",
      quoteIdentifier(this.branch.owner),
    ].join(" ");
  }
}

/**
 * Replace a procedure by dropping and recreating it.
 * This is used when properties that cannot be altered via ALTER FUNCTION/PROCEDURE change.
 */
export class ReplaceProcedure extends ReplaceChange {
  public readonly main: Procedure;
  public readonly branch: Procedure;

  constructor(props: { main: Procedure; branch: Procedure }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  serialize(): string {
    const dropChange = new DropProcedure({ procedure: this.main });
    const createChange = new CreateProcedure({ procedure: this.branch });

    return [dropChange.serialize(), createChange.serialize()].join(";\n");
  }
}
