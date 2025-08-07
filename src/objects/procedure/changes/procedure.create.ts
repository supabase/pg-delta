import { CreateChange, quoteIdentifier } from "../../base.change.ts";
import type { Procedure } from "../procedure.model.ts";
import { formatFunctionArguments } from "../utils.ts";

/**
 * Create a procedure.
 *
 * @see https://www.postgresql.org/docs/17/sql-createfunction.html
 *
 * Synopsis
 * ```sql
 * CREATE [ OR REPLACE ] FUNCTION
 *     name ( [ [ argmode ] [ argname ] argtype [ { DEFAULT | = } default_expr ] [, ...] ] )
 *     [ RETURNS rettype
 *       | RETURNS TABLE ( column_name column_type [, ...] ) ]
 *     { LANGUAGE lang_name
 *       | TRANSFORM { FOR TYPE type_name } [, ... ]
 *       | WINDOW
 *       | IMMUTABLE | STABLE | VOLATILE | [ NOT ] LEAKPROOF
 *       | CALLED ON NULL INPUT | RETURNS NULL ON NULL INPUT | STRICT
 *       | [ EXTERNAL ] SECURITY INVOKER | [ EXTERNAL ] SECURITY DEFINER
 *       | PARALLEL { UNSAFE | RESTRICTED | SAFE }
 *       | COST execution_cost
 *       | ROWS result_rows
 *       | SUPPORT support_function
 *       | SET configuration_parameter { TO value | = value | FROM CURRENT }
 *       | AS 'definition'
 *       | AS 'obj_file', 'link_symbol'
 *       | sql_body
 *     } ...
 * ```
 */
export class CreateProcedure extends CreateChange {
  public readonly procedure: Procedure;

  constructor(props: { procedure: Procedure }) {
    super();
    this.procedure = props.procedure;
  }

  serialize(): string {
    const parts: string[] = ["CREATE"];

    // Add FUNCTION or PROCEDURE based on kind
    const objectType = this.procedure.kind === "p" ? "PROCEDURE" : "FUNCTION";
    parts.push(objectType);

    // Add schema and name and arguments
    const args = formatFunctionArguments(
      this.procedure.argument_names,
      this.procedure.argument_types,
      this.procedure.argument_modes,
    );
    parts.push(
      `${quoteIdentifier(this.procedure.schema)}.${quoteIdentifier(this.procedure.name)}(${args})`,
    );

    // Add RETURNS clause for functions
    if (this.procedure.kind !== "p") {
      parts.push("RETURNS", this.procedure.return_type);
    }

    // Add LANGUAGE
    if (this.procedure.language) {
      parts.push("LANGUAGE", this.procedure.language);
    }

    // Add SECURITY DEFINER/INVOKER
    if (this.procedure.security_definer) {
      parts.push("SECURITY DEFINER");
    }
    // SECURITY INVOKER is default, don't print it

    // Add volatility
    const volatilityMap: Record<string, string> = {
      i: "IMMUTABLE",
      s: "STABLE",
      v: "VOLATILE",
    };
    if (this.procedure.volatility && this.procedure.volatility !== "v") {
      parts.push(volatilityMap[this.procedure.volatility]);
    }
    // VOLATILE is default, don't print it

    // Add parallel safety
    const parallelMap: Record<string, string> = {
      u: "PARALLEL UNSAFE",
      s: "PARALLEL SAFE",
      r: "PARALLEL RESTRICTED",
    };
    if (
      this.procedure.parallel_safety &&
      this.procedure.parallel_safety !== "u"
    ) {
      parts.push(parallelMap[this.procedure.parallel_safety]);
    }
    // PARALLEL UNSAFE is default, don't print it

    // Add STRICT
    if (this.procedure.is_strict) {
      parts.push("STRICT");
    }
    // CALLED ON NULL INPUT is default, don't print it

    // Add LEAKPROOF
    if (this.procedure.leakproof) {
      parts.push("LEAKPROOF");
    }
    // NOT LEAKPROOF is default, don't print it

    // Add AS clause
    if (this.procedure.sql_body) {
      parts.push("AS", `$$${this.procedure.sql_body}$$`);
    } else if (this.procedure.source_code) {
      parts.push("AS", `$$${this.procedure.source_code}$$`);
    } else {
      parts.push("AS", "$$SELECT 1$$");
    }

    return parts.join(" ");
  }
}
