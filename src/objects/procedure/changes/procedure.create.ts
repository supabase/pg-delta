import { CreateChange } from "../../base.change.ts";
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
  public readonly orReplace: boolean;

  constructor(props: { procedure: Procedure; orReplace?: boolean }) {
    super();
    this.procedure = props.procedure;
    this.orReplace = props.orReplace ?? false;
  }

  get dependencies() {
    return [this.procedure.stableId];
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
