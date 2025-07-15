import type { Sql } from "postgres";
import type { DependentDatabaseObject } from "../types.ts";
import type {
  InspectedColumn,
  InspectedColumnRow,
  ReplicaIdentity,
} from "./tables.ts";

interface InspectedMaterializedViewRow {
  schema: string;
  name: string;
  definition: string | null;
  row_security: boolean;
  force_row_security: boolean;
  has_indexes: boolean;
  has_rules: boolean;
  has_triggers: boolean;
  has_subclasses: boolean;
  is_populated: boolean;
  replica_identity: ReplicaIdentity;
  is_partition: boolean;
  options: string[] | null;
  partition_bound: string | null;
  owner: string;
  columns: InspectedColumnRow[];
}

export type InspectedMaterializedView = Omit<
  InspectedMaterializedViewRow,
  "columns"
> &
  DependentDatabaseObject & { columns: InspectedColumn[] };

function identifyMaterializedView(view: InspectedMaterializedViewRow): string {
  return `${view.schema}.${view.name}`;
}

export async function inspectMaterializedViews(
  sql: Sql,
): Promise<Record<string, InspectedMaterializedView>> {
  const materializedViews = await sql<InspectedMaterializedViewRow[]>`
with extension_oids as (
  select
    objid
  from
    pg_depend d
  where
    d.refclassid = 'pg_extension'::regclass
    and d.classid = 'pg_class'::regclass
), enums as (
  select
    t.oid as enum_oid,
    n.nspname as enum_schema,
    t.typname as enum_name
  from pg_type t
  left join pg_namespace n on n.oid = t.typnamespace
  left join extension_oids e on t.oid = e.objid
  where t.typcategory = 'E'
    and e.objid is null
), materialized_views as (
  select
    n.nspname as schema,
    c.relname as name,
    pg_get_viewdef(c.oid) as definition,
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
    pg_get_userbyid(c.relowner) as owner,
    c.oid as oid
  from
    pg_catalog.pg_class c
    inner join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    left outer join extension_oids e on c.oid = e.objid
  where n.nspname not in ('pg_internal', 'pg_catalog', 'information_schema', 'pg_toast')
    and n.nspname not like 'pg\_temp\_%' and n.nspname not like 'pg\_toast\_temp\_%'
    and e.objid is null
    and c.relkind = 'm'
)
select
  mv.schema,
  mv.name,
  mv.definition,
  mv.row_security,
  mv.force_row_security,
  mv.has_indexes,
  mv.has_rules,
  mv.has_triggers,
  mv.has_subclasses,
  mv.is_populated,
  mv.replica_identity,
  mv.is_partition,
  mv.options,
  mv.partition_bound,
  mv.owner,
  coalesce(json_agg(
    case when a.attname is not null then
      json_build_object(
        'name', a.attname,
        'position', a.attnum,
        'data_type', a.atttypid::regtype::text,
        'data_type_str', format_type(a.atttypid, a.atttypmod),
        'is_enum', (e.enum_oid is not null),
        'enum_schema', e.enum_schema,
        'enum_name', e.enum_name,
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
  materialized_views mv
  left join pg_attribute a on a.attrelid = mv.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef ad on a.attrelid = ad.adrelid and a.attnum = ad.adnum
  left join enums e on a.atttypid = e.enum_oid
group by
  mv.schema, mv.name, mv.definition, mv.row_security, mv.force_row_security, mv.has_indexes, mv.has_rules, mv.has_triggers, mv.has_subclasses, mv.is_populated, mv.replica_identity, mv.is_partition, mv.options, mv.partition_bound, mv.owner
order by
  mv.schema, mv.name;
  `;

  return Object.fromEntries(
    materializedViews.map((v) => [
      identifyMaterializedView(v),
      {
        ...v,
        dependent_on: [],
        dependents: [],
        columns: v.columns.map((col) => ({
          ...col,
          dependent_on: [],
          dependents: [],
        })),
      },
    ]),
  );
}
