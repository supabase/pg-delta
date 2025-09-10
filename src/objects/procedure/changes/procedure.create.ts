import { CreateChange } from "../../base.change.ts";
import type { Procedure } from "../procedure.model.ts";
import { formatConfigValue, formatFunctionArguments } from "../utils.ts";

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
  public readonly orReplace: boolean;

  constructor(props: { procedure: Procedure; orReplace?: boolean }) {
    super();
    this.procedure = props.procedure;
    this.orReplace = props.orReplace ?? false;
  }

  get stableId(): string {
    return `${this.procedure.stableId}`;
  }

  serialize(): string {
    const parts: string[] = ["CREATE"];
    if (this.orReplace) parts.push("OR REPLACE");

    // Add FUNCTION or PROCEDURE based on kind
    const objectType = this.procedure.kind === "p" ? "PROCEDURE" : "FUNCTION";
    parts.push(objectType);

    // Add schema and name and arguments
    const args = formatFunctionArguments(
      this.procedure.argument_names,
      this.procedure.argument_types,
      this.procedure.argument_modes,
    );
    parts.push(`${this.procedure.schema}.${this.procedure.name}(${args})`);

    // Add RETURNS clause for functions (omit for procedures)
    if (this.procedure.kind !== "p") {
      const returnsParts: string[] = ["RETURNS"];
      if (this.procedure.returns_set) {
        returnsParts.push("SETOF");
      }
      returnsParts.push(this.procedure.return_type);
      parts.push(returnsParts.join(" "));
    }

    // Add LANGUAGE
    if (this.procedure.language) {
      parts.push("LANGUAGE", this.procedure.language);
    }

    // Mark window functions explicitly
    if (this.procedure.kind === "w") {
      parts.push("WINDOW");
    }

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

    // Add LEAKPROOF
    if (this.procedure.leakproof) {
      parts.push("LEAKPROOF");
    }
    // NOT LEAKPROOF is default, don't print it

    // Add STRICT
    if (this.procedure.is_strict) {
      parts.push("STRICT");
    }
    // CALLED ON NULL INPUT is default, don't print it

    // Add SECURITY DEFINER/INVOKER
    if (this.procedure.security_definer) {
      parts.push("SECURITY DEFINER");
    }
    // SECURITY INVOKER is default, don't print it

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

    // Add COST for functions (not procedures). Skip default values
    if (this.procedure.kind !== "p") {
      const languageLower = (this.procedure.language || "").toLowerCase();
      // Defaults: 1 for C/internal functions; 100 for all other languages
      const defaultCost =
        languageLower === "c" || languageLower === "internal" ? 1 : 100;
      if (
        typeof this.procedure.execution_cost === "number" &&
        this.procedure.execution_cost !== defaultCost
      ) {
        parts.push("COST", String(this.procedure.execution_cost));
      }

      // Add ROWS for set-returning functions when non-default
      if (
        this.procedure.returns_set &&
        typeof this.procedure.result_rows === "number"
      ) {
        const defaultRows = 1000; // PostgreSQL default for set-returning functions
        const rows = this.procedure.result_rows;
        if (rows > 0 && rows !== defaultRows) {
          parts.push("ROWS", String(rows));
        }
      }
    }

    // Add SET configuration parameters (only non-defaults; default is no SET)
    if (this.procedure.config && this.procedure.config.length > 0) {
      for (const opt of this.procedure.config) {
        const eqIndex = opt.indexOf("=");
        if (eqIndex === -1) continue;
        const key = opt.slice(0, eqIndex).trim();
        const rawValue = opt.slice(eqIndex + 1).trim();
        const formatted = formatConfigValue(key, rawValue);
        parts.push("SET", `${key} TO ${formatted}`);
      }
    }

    // Add AS clause
    const lang = (this.procedure.language || "").toLowerCase();
    if (lang === "sql") {
      // Prefer normalized body extracted from definition, then fall back
      let body: string | null = null;
      if (this.procedure.definition) {
        // Prefer extracting from dollar-quoted body using the same tag on both sides
        let match = this.procedure.definition.match(
          /AS\s+(\$[^$]*\$)([\s\S]*?)\1/i,
        );
        if (match && match[2] != null) {
          body = match[2].trim();
        } else {
          // Fallback: single-quoted body in definition
          match = this.procedure.definition.match(/AS\s+'([\s\S]*?)'/i);
          if (match && match[1] != null) {
            body = match[1].replace(/''/g, "'").trim();
          }
        }
      }
      if (!body) {
        body = (
          this.procedure.sql_body ||
          this.procedure.source_code ||
          ""
        ).trim();
      }
      if (body) {
        const singleQuoted = body.replace(/'/g, "''");
        parts.push("AS", `'${singleQuoted}'`);
      }
    } else {
      if (this.procedure.sql_body) {
        parts.push("AS", `$$${this.procedure.sql_body}$$`);
      } else if (this.procedure.source_code) {
        parts.push("AS", `$$${this.procedure.source_code}$$`);
      }
    }

    return parts.join(" ");
  }
}
