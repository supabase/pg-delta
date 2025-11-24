import type { Sql } from "postgres";
import z from "zod";
import {
  BasePgModel,
  columnPropsSchema,
  type TableLikeObject,
} from "../../base.model.ts";
import {
  type PrivilegeProps,
  privilegePropsSchema,
} from "../../base.privilege-diff.ts";

/**
 * All properties exposed by CREATE FOREIGN TABLE statement are included in diff output.
 * https://www.postgresql.org/docs/17/sql-createforeigntable.html
 *
 * ALTER FOREIGN TABLE statement can be generated for changes to the following properties:
 *  - owner, columns, options
 * https://www.postgresql.org/docs/17/sql-alterforeigntable.html
 *
 * Foreign tables are schema-qualified and similar to regular tables but reference a server.
 */
const foreignTablePropsSchema = z.object({
  schema: z.string(),
  name: z.string(),
  owner: z.string(),
  server: z.string(),
  options: z.array(z.string()).nullable(),
  comment: z.string().nullable(),
  columns: z.array(columnPropsSchema),
  privileges: z.array(privilegePropsSchema),
});

type ForeignTablePrivilegeProps = PrivilegeProps;
export type ForeignTableProps = z.infer<typeof foreignTablePropsSchema>;

export class ForeignTable extends BasePgModel implements TableLikeObject {
  public readonly schema: ForeignTableProps["schema"];
  public readonly name: ForeignTableProps["name"];
  public readonly owner: ForeignTableProps["owner"];
  public readonly server: ForeignTableProps["server"];
  public readonly options: ForeignTableProps["options"];
  public readonly comment: ForeignTableProps["comment"];
  public readonly columns: ForeignTableProps["columns"];
  public readonly privileges: ForeignTablePrivilegeProps[];

  constructor(props: ForeignTableProps) {
    super();

    // Identity fields
    this.schema = props.schema;
    this.name = props.name;

    // Data fields
    this.owner = props.owner;
    this.server = props.server;
    this.options = props.options;
    this.comment = props.comment;
    this.columns = props.columns;
    this.privileges = props.privileges;
  }

  get stableId(): `foreignTable:${string}` {
    return `foreignTable:${this.schema}.${this.name}`;
  }

  get identityFields() {
    return {
      schema: this.schema,
      name: this.name,
    };
  }

  get dataFields() {
    return {
      owner: this.owner,
      server: this.server,
      options: this.options,
      comment: this.comment,
      columns: this.columns,
      privileges: this.privileges,
    };
  }
}

export async function extractForeignTables(sql: Sql): Promise<ForeignTable[]> {
  return sql.begin(async (sql) => {
    await sql`set search_path = ''`;
    const tableRows = await sql`
      with extension_oids as (
        select objid
        from pg_depend d
        where d.refclassid = 'pg_extension'::regclass
          and d.classid = 'pg_class'::regclass
      ), foreign_tables as (
        select
          c.relnamespace::regnamespace::text as schema,
          quote_ident(c.relname) as name,
          c.relowner::regrole::text as owner,
          quote_ident(srv.srvname) as server,
          coalesce(ft.ftoptions, array[]::text[]) as options,
          c.oid as oid
        from
          pg_class c
          inner join pg_foreign_table ft on ft.ftrelid = c.oid
          inner join pg_foreign_server srv on srv.oid = ft.ftserver
          inner join pg_foreign_data_wrapper fdw on fdw.oid = srv.srvfdw
          left outer join extension_oids e1 on c.oid = e1.objid
        where
          c.relkind = 'f'
          and not c.relnamespace::regnamespace::text like any(array['pg\\_%', 'information\\_schema'])
          and e1.objid is null
          and not fdw.fdwname like any(array['pg\\_%'])
      )
      select
        ft.schema,
        ft.name,
        ft.owner,
        ft.server,
        ft.options,
        obj_description(ft.oid, 'pg_class') as comment,
        coalesce(json_agg(
          case when a.attname is not null then
            json_build_object(
              'name', quote_ident(a.attname),
              'position', a.attnum,
              'data_type', a.atttypid::regtype::text,
              'data_type_str', format_type(a.atttypid, a.atttypmod),
              'is_custom_type', ty.typnamespace::regnamespace::text not in ('pg_catalog', 'information_schema'),
              'custom_type_type', case when ty.typnamespace::regnamespace::text not in ('pg_catalog', 'information_schema') then ty.typtype else null end,
              'custom_type_category', case when ty.typnamespace::regnamespace::text not in ('pg_catalog', 'information_schema') then ty.typcategory else null end,
              'custom_type_schema', case when ty.typnamespace::regnamespace::text not in ('pg_catalog', 'information_schema') then ty.typnamespace::regnamespace else null end,
              'custom_type_name', case when ty.typnamespace::regnamespace::text not in ('pg_catalog', 'information_schema') then quote_ident(ty.typname) else null end,
              'not_null', a.attnotnull,
              'is_identity', a.attidentity != '',
              'is_identity_always', a.attidentity = 'a',
              'is_generated', a.attgenerated != '',
              'collation', (
                select quote_ident(c2.collname)
                from pg_collation c2, pg_type t2
                where c2.oid = a.attcollation
                  and t2.oid = a.atttypid
                  and a.attcollation <> t2.typcollation
              ),
              'default', pg_get_expr(ad.adbin, ad.adrelid),
              'comment', col_description(a.attrelid, a.attnum)
            )
          end
          order by a.attnum
        ) filter (where a.attname is not null), '[]') as columns,
        coalesce((
          select json_agg(
                  json_build_object(
                    'grantee', case when grp.grantee = 0 then 'PUBLIC' else grp.grantee::regrole::text end,
                    'privilege', grp.privilege_type,
                    'grantable', grp.is_grantable,
                    'columns', case when grp.cols is not null and array_length(grp.cols,1) > 0
                                    then grp.cols
                                    else null end
                  )
                  order by grp.grantee, grp.privilege_type
                )
          from (
            select
              x.grantee,
              x.privilege_type,
              bool_or(x.is_grantable) as is_grantable,
              array_agg(quote_ident(src.attname) order by src.attname)
                filter (where src.attname is not null) as cols
            from (
              -- one row for object ACL + one row per column ACL
              select null::name as attname, ft.oid as relacl_oid, (
                select c_rel.relacl from pg_class c_rel where c_rel.oid = ft.oid
              ) as acl
              union all
              select a2.attname, ft.oid as relacl_oid, a2.attacl
              from pg_attribute a2
              where a2.attrelid = ft.oid
                and a2.attnum > 0
                and not a2.attisdropped
                and a2.attacl is not null
            ) as src
            join lateral aclexplode(src.acl) as x(grantor, grantee, privilege_type, is_grantable) on true
            group by x.grantee, x.privilege_type
          ) as grp
        ), '[]') as privileges
      from
        foreign_tables ft
        left join pg_attribute a on a.attrelid = ft.oid and a.attnum > 0 and not a.attisdropped
        left join pg_attrdef ad on a.attrelid = ad.adrelid and a.attnum = ad.adnum
        left join pg_type ty on ty.oid = a.atttypid
      group by
        ft.oid, ft.schema, ft.name, ft.owner, ft.server, ft.options
      order by
        ft.schema, ft.name;
    `;

    // Validate and parse each row using the Zod schema
    const validatedRows = tableRows.map((row: unknown) => {
      const parsed = foreignTablePropsSchema.parse(row);
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
    return validatedRows.map((row: ForeignTableProps) => new ForeignTable(row));
  });
}
