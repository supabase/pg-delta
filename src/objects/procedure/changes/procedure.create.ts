import { parseTypeString, stableId } from "../../utils.ts";
import type { Procedure } from "../procedure.model.ts";
import { CreateProcedureChange } from "./procedure.base.ts";

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
export class CreateProcedure extends CreateProcedureChange {
  public readonly procedure: Procedure;
  public readonly orReplace: boolean;
  public readonly scope = "object" as const;

  constructor(props: { procedure: Procedure; orReplace?: boolean }) {
    super();
    this.procedure = props.procedure;
    this.orReplace = props.orReplace ?? false;
  }

  get creates() {
    return [this.procedure.stableId];
  }

  get requires() {
    const dependencies = new Set<string>();

    // Schema dependency
    dependencies.add(stableId.schema(this.procedure.schema));

    // Owner dependency
    dependencies.add(stableId.role(this.procedure.owner));

    // Language dependency (if user-defined)
    // Note: Most languages are built-in (plpgsql, sql, etc.), but custom languages
    // can be created. We can't reliably determine if a language is user-defined
    // from just the name, so we rely on pg_depend for language dependencies.

    // Return type dependency (if user-defined)
    const returnType = parseTypeString(this.procedure.return_type);
    if (returnType) {
      dependencies.add(stableId.type(returnType.schema, returnType.name));
    }

    // Argument type dependencies (if user-defined)
    if (this.procedure.argument_types) {
      for (const argType of this.procedure.argument_types) {
        const parsedType = parseTypeString(argType);
        if (parsedType) {
          dependencies.add(stableId.type(parsedType.schema, parsedType.name));
        }
      }
    }

    return Array.from(dependencies);
  }

  serialize(): string {
    // Use the server-generated CREATE statement for functions/procedures
    // Normalize trailing semicolon and OR REPLACE clause according to flag
    let definition = this.procedure.definition.trim();
    definition = definition.replace(/;\s*$/, "");
    definition = definition.replace(
      /^CREATE\s+(?:OR\s+REPLACE\s+)?/i,
      `CREATE ${this.orReplace ? "OR REPLACE " : ""}`,
    );
    return definition;
  }
}
