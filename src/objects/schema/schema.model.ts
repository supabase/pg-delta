import type { Sql } from "postgres";
import z from "zod";
import { BasePgModel } from "../base.model.ts";
import {
  type PrivilegeProps,
  privilegePropsSchema,
} from "../base.privilege-diff.ts";

/**
 * All properties exposed by CREATE SCHEMA statement are included in diff output.
 * https://www.postgresql.org/docs/current/sql-createschema.html
 *
 * ALTER SCHEMA statement can be generated for all properties.
 * https://www.postgresql.org/docs/current/sql-alterschema.html
 */
const schemaPropsSchema = z.object({
  name: z.string(),
  owner: z.string(),
  comment: z.string().nullable(),
  privileges: z.array(privilegePropsSchema),
});

type SchemaPrivilegeProps = PrivilegeProps;
export type SchemaProps = z.infer<typeof schemaPropsSchema>;

export class Schema extends BasePgModel {
  public readonly name: SchemaProps["name"];
  public readonly owner: SchemaProps["owner"];
  public readonly comment: SchemaProps["comment"];
  public readonly privileges: SchemaPrivilegeProps[];

  constructor(props: SchemaProps) {
    super();

    // Identity fields
    this.name = props.name;

    // Data fields
    this.owner = props.owner;
    this.comment = props.comment;
    this.privileges = props.privileges;
  }

  get stableId(): `schema:${string}` {
    return `schema:${this.name}`;
  }

  get identityFields() {
    return {
      name: this.name,
    };
  }

  get dataFields() {
    return {
      owner: this.owner,
      comment: this.comment,
      privileges: this.privileges,
    };
  }
}

export async function extractSchemas(sql: Sql): Promise<Schema[]> {
  return sql.begin(async (sql) => {
    await sql`set search_path = ''`;
    const schemaRows = await sql`
    with extension_oids as (
      select
        objid
      from
        pg_depend d
      where
        d.refclassid = 'pg_extension'::regclass
        and d.classid = 'pg_namespace'::regclass
    )
    select
      quote_ident(nspname) as name,
      nspowner::regrole::text as owner,
      obj_description(oid, 'pg_namespace') as comment,
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
          from lateral aclexplode(nspacl) as x(grantor, grantee, privilege_type, is_grantable)
        ), '[]'
      ) as privileges
    from
      pg_catalog.pg_namespace
      left outer join extension_oids e on e.objid = oid
      -- <EXCLUDE_INTERNAL>
      where not nspname like any(array['pg\\_%', 'information\\_schema'])
      and e.objid is null
      -- </EXCLUDE_INTERNAL>
    order by
      1;
  `;
    // Validate and parse each row using the Zod schema
    const validatedRows = schemaRows.map((row: unknown) =>
      schemaPropsSchema.parse(row),
    );
    return validatedRows.map((row: SchemaProps) => new Schema(row));
  });
}
