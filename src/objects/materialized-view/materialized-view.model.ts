import type { Sql } from "postgres";
import z from "zod";
import {
  BasePgModel,
  columnPropsSchema,
  type TableLikeObject,
} from "../base.model.ts";
import { ReplicaIdentitySchema } from "../table/table.model.ts";

const materializedViewPropsSchema = z.object({
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
  columns: z.array(columnPropsSchema),
});

export type MaterializedViewProps = z.infer<typeof materializedViewPropsSchema>;

export class MaterializedView extends BasePgModel implements TableLikeObject {
  public readonly schema: MaterializedViewProps["schema"];
  public readonly name: MaterializedViewProps["name"];
  public readonly definition: MaterializedViewProps["definition"];
  public readonly row_security: MaterializedViewProps["row_security"];
  public readonly force_row_security: MaterializedViewProps["force_row_security"];
  public readonly has_indexes: MaterializedViewProps["has_indexes"];
  public readonly has_rules: MaterializedViewProps["has_rules"];
  public readonly has_triggers: MaterializedViewProps["has_triggers"];
  public readonly has_subclasses: MaterializedViewProps["has_subclasses"];
  public readonly is_populated: MaterializedViewProps["is_populated"];
  public readonly replica_identity: MaterializedViewProps["replica_identity"];
  public readonly is_partition: MaterializedViewProps["is_partition"];
  public readonly options: MaterializedViewProps["options"];
  public readonly partition_bound: MaterializedViewProps["partition_bound"];
  public readonly owner: MaterializedViewProps["owner"];
  public readonly columns: MaterializedViewProps["columns"];

  constructor(props: MaterializedViewProps) {
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
    this.columns = props.columns;
  }

  get stableId(): `materializedView:${string}` {
    return `materializedView:${this.schema}.${this.name}`;
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
      columns: this.columns,
    };
  }
}

export async function extractMaterializedViews(
  sql: Sql,
): Promise<MaterializedView[]> {
  return sql.begin(async (sql) => {
    await sql`set search_path = ''`;
    const mvRows = await sql`
with extension_oids as (
  select
    objid
  from
    pg_depend d
  where
    d.refclassid = 'pg_extension'::regclass
    and d.classid = 'pg_class'::regclass
)
select
  regexp_replace(c.relnamespace::regnamespace::text, '^"(.*)"$', '\\1') as schema,
  c.relname as name,
  -- remove trailing semicolon from the definition if present
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
  c.relowner::regrole as owner,
  coalesce(json_agg(
    case when a.attname is not null then
      json_build_object(
        'name', a.attname,
        'position', a.attnum,
        'data_type', a.atttypid::regtype::text,
        'data_type_str', format_type(a.atttypid, a.atttypmod),
        'is_custom_type', ty.typnamespace::regnamespace::text not in ('pg_catalog', 'information_schema'),
        'custom_type_type', case when ty.typnamespace::regnamespace::text not in ('pg_catalog', 'information_schema') then ty.typtype else null end,
        'custom_type_category', case when ty.typnamespace::regnamespace::text not in ('pg_catalog', 'information_schema') then ty.typcategory else null end,
        'custom_type_schema', case when ty.typnamespace::regnamespace::text not in ('pg_catalog', 'information_schema') then ty.typnamespace::regnamespace else null end,
        'custom_type_name', case when ty.typnamespace::regnamespace::text not in ('pg_catalog', 'information_schema') then ty.typname else null end,
        'not_null', a.attnotnull,
        'is_identity', a.attidentity != '',
        'is_identity_always', a.attidentity = 'a',
        'is_generated', a.attgenerated != '',
        'collation', (
          select c2.collname
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
  ) filter (where a.attname is not null), '[]') as columns
from
  pg_catalog.pg_class c
  left outer join extension_oids e on c.oid = e.objid
  left join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef ad on a.attrelid = ad.adrelid and a.attnum = ad.adnum
  left join pg_type ty on ty.oid = a.atttypid
where not c.relnamespace::regnamespace::text like any(array['pg\\_%', 'information\\_schema'])
  and e.objid is null
  and c.relkind = 'm'
group by
  c.relnamespace, c.relname, pg_get_viewdef(c.oid), c.relrowsecurity, c.relforcerowsecurity, c.relhasindex, c.relhasrules, c.relhastriggers, c.relhassubclass, c.relispopulated, c.relreplident, c.relispartition, c.reloptions, pg_get_expr(c.relpartbound, c.oid), c.relowner
order by
  c.relnamespace::regnamespace, c.relname;
    `;
    // Validate and parse each row using the Zod schema
    const validatedRows = mvRows.map((row: unknown) =>
      materializedViewPropsSchema.parse(row),
    );
    return validatedRows.map(
      (row: MaterializedViewProps) => new MaterializedView(row),
    );
  });
}
