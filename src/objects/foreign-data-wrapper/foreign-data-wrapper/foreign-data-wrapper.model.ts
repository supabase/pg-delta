import type { Sql } from "postgres";
import z from "zod";
import { BasePgModel } from "../../base.model.ts";
import {
  type PrivilegeProps,
  privilegePropsSchema,
} from "../../base.privilege-diff.ts";

/**
 * All properties exposed by CREATE FOREIGN DATA WRAPPER statement are included in diff output.
 * https://www.postgresql.org/docs/17/sql-createforeigndatawrapper.html
 *
 * ALTER FOREIGN DATA WRAPPER statement can be generated for changes to the following properties:
 *  - owner, handler, validator, options
 * https://www.postgresql.org/docs/17/sql-alterforeigndatawrapper.html
 *
 * Foreign Data Wrappers are not schema-qualified (no schema property).
 */
const foreignDataWrapperPropsSchema = z.object({
  name: z.string(),
  owner: z.string(),
  handler: z.string().nullable(),
  validator: z.string().nullable(),
  options: z.array(z.string()).nullable(),
  comment: z.string().nullable(),
  privileges: z.array(privilegePropsSchema),
});

type ForeignDataWrapperPrivilegeProps = PrivilegeProps;
export type ForeignDataWrapperProps = z.infer<
  typeof foreignDataWrapperPropsSchema
>;

export class ForeignDataWrapper extends BasePgModel {
  public readonly name: ForeignDataWrapperProps["name"];
  public readonly owner: ForeignDataWrapperProps["owner"];
  public readonly handler: ForeignDataWrapperProps["handler"];
  public readonly validator: ForeignDataWrapperProps["validator"];
  public readonly options: ForeignDataWrapperProps["options"];
  public readonly comment: ForeignDataWrapperProps["comment"];
  public readonly privileges: ForeignDataWrapperPrivilegeProps[];

  constructor(props: ForeignDataWrapperProps) {
    super();

    // Identity fields
    this.name = props.name;

    // Data fields
    this.owner = props.owner;
    this.handler = props.handler;
    this.validator = props.validator;
    this.options = props.options;
    this.comment = props.comment;
    this.privileges = props.privileges;
  }

  get stableId(): `foreignDataWrapper:${string}` {
    return `foreignDataWrapper:${this.name}`;
  }

  get identityFields() {
    return {
      name: this.name,
    };
  }

  get dataFields() {
    return {
      owner: this.owner,
      handler: this.handler,
      validator: this.validator,
      options: this.options,
      comment: this.comment,
      privileges: this.privileges,
    };
  }
}

export async function extractForeignDataWrappers(
  sql: Sql,
): Promise<ForeignDataWrapper[]> {
  return sql.begin(async (sql) => {
    await sql`set search_path = ''`;
    const fdwRows = await sql`
      select
        quote_ident(fdw.fdwname) as name,
        fdw.fdwowner::regrole::text as owner,
        case
          when fdw.fdwhandler = 0 then null
          else p_handler.pronamespace::regnamespace::text || '.' || quote_ident(p_handler.proname) || '(' || pg_get_function_identity_arguments(fdw.fdwhandler) || ')'
        end as handler,
        case
          when fdw.fdwvalidator = 0 then null
          else p_validator.pronamespace::regnamespace::text || '.' || quote_ident(p_validator.proname) || '(' || pg_get_function_identity_arguments(fdw.fdwvalidator) || ')'
        end as validator,
        coalesce(fdw.fdwoptions, array[]::text[]) as options,
        obj_description(fdw.oid, 'pg_foreign_data_wrapper') as comment,
        coalesce(
          (
            select json_agg(
              json_build_object(
                'grantee', case when x.grantee = 0 then 'PUBLIC' else x.grantee::regrole::text end,
                'privilege', x.privilege_type,
                'grantable', x.is_grantable
              )
              order by x.grantee, x.privilege_type
            )
            from lateral aclexplode(fdw.fdwacl) as x(grantor, grantee, privilege_type, is_grantable)
          ), '[]'
        ) as privileges
      from
        pg_catalog.pg_foreign_data_wrapper fdw
        left join pg_catalog.pg_proc p_handler on p_handler.oid = fdw.fdwhandler
        left join pg_catalog.pg_proc p_validator on p_validator.oid = fdw.fdwvalidator
      where
        not fdw.fdwname like any(array['pg\\_%'])
      order by
        fdw.fdwname;
    `;

    // Validate and parse each row using the Zod schema
    const validatedRows = fdwRows.map((row: unknown) => {
      const parsed = foreignDataWrapperPropsSchema.parse(row);
      // Parse options from PostgreSQL format ['key=value'] to ['key', 'value']
      if (parsed.options && parsed.options.length > 0) {
        const parsedOptions: string[] = [];
        for (const opt of parsed.options) {
          const eqIndex = opt.indexOf("=");
          if (eqIndex > 0) {
            parsedOptions.push(opt.substring(0, eqIndex));
            parsedOptions.push(opt.substring(eqIndex + 1));
          }
        }
        parsed.options = parsedOptions.length > 0 ? parsedOptions : null;
      }
      return parsed;
    });
    return validatedRows.map(
      (row: ForeignDataWrapperProps) => new ForeignDataWrapper(row),
    );
  });
}
