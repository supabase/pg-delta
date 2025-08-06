import { CreateChange, quoteIdentifier } from "../../base.change.ts";
import type { Procedure } from "../procedure.model.ts";

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
    const parts: string[] = ["CREATE OR REPLACE"];

    // Add FUNCTION or PROCEDURE based on kind
    const objectType = this.procedure.kind === "p" ? "PROCEDURE" : "FUNCTION";
    parts.push(objectType);

    // Add schema and name
    parts.push(
      `${quoteIdentifier(this.procedure.schema)}.${quoteIdentifier(this.procedure.name)}`,
    );

    // Add arguments (simplified)
    parts.push("()");

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
    } else {
      parts.push("SECURITY INVOKER");
    }

    // Add volatility
    const volatilityMap: Record<string, string> = {
      i: "IMMUTABLE",
      s: "STABLE",
      v: "VOLATILE",
    };
    if (this.procedure.volatility) {
      parts.push(volatilityMap[this.procedure.volatility] || "VOLATILE");
    }

    // Add parallel safety
    const parallelMap: Record<string, string> = {
      u: "PARALLEL UNSAFE",
      s: "PARALLEL SAFE",
      r: "PARALLEL RESTRICTED",
    };
    if (this.procedure.parallel_safety) {
      parts.push(
        parallelMap[this.procedure.parallel_safety] || "PARALLEL UNSAFE",
      );
    }

    // Add STRICT
    if (this.procedure.is_strict) {
      parts.push("STRICT");
    }

    // Add LEAKPROOF
    if (this.procedure.leakproof) {
      parts.push("LEAKPROOF");
    }

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
