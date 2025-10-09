import type { Sql } from "postgres";
import z from "zod";
import {
  BasePgModel,
  columnPropsSchema,
  type TableLikeObject,
} from "../base.model.ts";
import {
  type PrivilegeProps,
  privilegePropsSchema,
} from "../base.privilege-diff.ts";
import { ReplicaIdentitySchema } from "../table/table.model.ts";

const viewPropsSchema = z.object({
  schema: z.string(),
  name: z.string(),
  definition: z.string(),
  row_security: z.boolean(),
  force_row_security: z.boolean(),
  has_indexes: z.boolean(),
  has_rules: z.boolean(),
  has_triggers: z.boolean(),
  has_subclasses: z.boolean(),
  is_populated: z.boolean(),
  replica_identity: ReplicaIdentitySchema,
  is_partition: z.boolean(),
  options: z.array(z.string()).nullable(),
  partition_bound: z.string().nullable(),
  owner: z.string(),
  comment: z.string().nullable(),
  columns: z.array(columnPropsSchema),
  privileges: z.array(privilegePropsSchema),
});

type ViewPrivilegeProps = PrivilegeProps;
export type ViewProps = z.infer<typeof viewPropsSchema>;

export class View extends BasePgModel implements TableLikeObject {
  public readonly schema: ViewProps["schema"];
  public readonly name: ViewProps["name"];
  public readonly definition: ViewProps["definition"];
  public readonly row_security: ViewProps["row_security"];
  public readonly force_row_security: ViewProps["force_row_security"];
  public readonly has_indexes: ViewProps["has_indexes"];
  public readonly has_rules: ViewProps["has_rules"];
  public readonly has_triggers: ViewProps["has_triggers"];
  public readonly has_subclasses: ViewProps["has_subclasses"];
  public readonly is_populated: ViewProps["is_populated"];
  public readonly replica_identity: ViewProps["replica_identity"];
  public readonly is_partition: ViewProps["is_partition"];
  public readonly options: ViewProps["options"];
  public readonly partition_bound: ViewProps["partition_bound"];
  public readonly owner: ViewProps["owner"];
  public readonly comment: ViewProps["comment"];
  public readonly columns: ViewProps["columns"];
  public readonly privileges: ViewPrivilegeProps[];

  constructor(props: ViewProps) {
    super();

    // Identity fields
    this.schema = props.schema;
    this.name = props.name;

    // Data fields
    this.definition = props.definition;
    this.row_security = props.row_security;
    this.force_row_security = props.force_row_security;
    this.has_indexes = props.has_indexes;
    this.has_rules = props.has_rules;
    this.has_triggers = props.has_triggers;
    this.has_subclasses = props.has_subclasses;
    this.is_populated = props.is_populated;
    this.replica_identity = props.replica_identity;
    this.is_partition = props.is_partition;
    this.options = props.options;
    this.partition_bound = props.partition_bound;
    this.owner = props.owner;
    this.comment = props.comment;
    this.columns = props.columns;
    this.privileges = props.privileges;
  }

  get stableId(): `view:${string}` {
    return `view:${this.schema}.${this.name}`;
  }

  get identityFields() {
    return {
      schema: this.schema,
      name: this.name,
    };
  }

  get dataFields() {
    return {
      definition: this.definition,
      row_security: this.row_security,
      force_row_security: this.force_row_security,
      has_indexes: this.has_indexes,
      has_rules: this.has_rules,
      has_triggers: this.has_triggers,
      has_subclasses: this.has_subclasses,
      is_populated: this.is_populated,
      replica_identity: this.replica_identity,
      is_partition: this.is_partition,
      options: this.options,
      partition_bound: this.partition_bound,
      owner: this.owner,
      comment: this.comment,
      columns: this.columns,
      privileges: this.privileges,
    };
  }
}

export async function extractViews(sql: Sql): Promise<View[]> {
  return sql.begin(async (sql) => {
    await sql`set search_path = ''`;
    const viewRows = await sql`
with extension_oids as (
  select
    objid
  from
    pg_depend d
  where
    d.refclassid = 'pg_extension'::regclass
    and d.classid = 'pg_class'::regclass
), views as (
  select
    c.relnamespace::regnamespace::text as schema,
    quote_ident(c.relname) as name,
    rtrim(pg_get_viewdef(c.oid), ';') as definition,
    c.relrowsecurity as row_security,
    c.relforcerowsecurity as force_row_security,
    c.relhasindex as has_indexes,
    c.relhasrules as has_rules,
    c.relhastriggers as has_triggers,
    c.relhassubclass as has_subclasses,
    c.relispopulated as is_populated,
    c.relreplident as replica_identity,
    c.relispartition as is_partition,
    c.reloptions as options,
    pg_get_expr(c.relpartbound, c.oid) as partition_bound,
    c.relowner::regrole::text as owner,
    obj_description(c.oid, 'pg_class') as comment,
    c.oid as oid
  from
    pg_catalog.pg_class c
    left outer join extension_oids e on c.oid = e.objid
  where not c.relnamespace::regnamespace::text like any(array['pg\\_%', 'information\\_schema'])
    and e.objid is null
    and c.relkind = 'v'
)
select
  v.schema,
  v.name,
  v.definition,
  v.row_security,
  v.force_row_security,
  v.has_indexes,
  v.has_rules,
  v.has_triggers,
  v.has_subclasses,
  v.is_populated,
  v.replica_identity,
  v.is_partition,
  v.options,
  v.partition_bound,
  v.owner,
  v.comment,
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
        select null::name as attname, v.oid as relacl_oid, (
          select c_rel.relacl from pg_class c_rel where c_rel.oid = v.oid
        ) as acl
        union all
        select a2.attname, v.oid as relacl_oid, a2.attacl
        from pg_attribute a2
        where a2.attrelid = v.oid
          and a2.attnum > 0
          and not a2.attisdropped
          and a2.attacl is not null
      ) as src
      join lateral aclexplode(src.acl) as x(grantor, grantee, privilege_type, is_grantable) on true
      group by x.grantee, x.privilege_type
    ) as grp
  ), '[]') as privileges
from
  views v
  left join pg_attribute a on a.attrelid = v.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef ad on a.attrelid = ad.adrelid and a.attnum = ad.adnum
  left join pg_type ty on ty.oid = a.atttypid
group by
  v.oid, v.schema, v.name, v.definition, v.row_security, v.force_row_security, v.has_indexes, v.has_rules, v.has_triggers, v.has_subclasses, v.is_populated, v.replica_identity, v.is_partition, v.options, v.partition_bound, v.owner, v.comment
order by
  v.schema, v.name;
    `;
    // Validate and parse each row using the Zod schema
    const validatedRows = viewRows.map((row: unknown) =>
      viewPropsSchema.parse(row),
    );
    return validatedRows.map((row: ViewProps) => new View(row));
  });
}
