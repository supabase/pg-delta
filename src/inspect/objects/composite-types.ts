import type { Sql } from "postgres";
import type { DependentDatabaseObject } from "../types.ts";
import type {
  InspectedColumn,
  InspectedColumnRow,
  ReplicaIdentity,
} from "./tables.ts";

interface InspectedCompositeTypeRow {
  schema: string;
  name: string;
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

export type InspectedCompositeType = Omit<
  InspectedCompositeTypeRow,
  "columns"
> &
  DependentDatabaseObject & { columns: InspectedColumn[] };

function identifyCompositeType(type: InspectedCompositeTypeRow): string {
  return `${type.schema}.${type.name}`;
}

export async function inspectCompositeTypes(
  sql: Sql,
): Promise<Map<string, InspectedCompositeType>> {
  const compositeTypes = await sql<InspectedCompositeTypeRow[]>`
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
), composite_types as (
  select
    n.nspname as schema,
    c.relname as name,
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
    and c.relkind = 'c'
)
select
  ct.schema,
  ct.name,
  ct.row_security,
  ct.force_row_security,
  ct.has_indexes,
  ct.has_rules,
  ct.has_triggers,
  ct.has_subclasses,
  ct.is_populated,
  ct.replica_identity,
  ct.is_partition,
  ct.options,
  ct.partition_bound,
  ct.owner,
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
  composite_types ct
  left join pg_attribute a on a.attrelid = ct.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef ad on a.attrelid = ad.adrelid and a.attnum = ad.adnum
  left join enums e on a.atttypid = e.enum_oid
group by
  ct.schema, ct.name, ct.row_security, ct.force_row_security, ct.has_indexes, ct.has_rules, ct.has_triggers, ct.has_subclasses, ct.is_populated, ct.replica_identity, ct.is_partition, ct.options, ct.partition_bound, ct.owner
order by
  ct.schema, ct.name;
  `;

  return new Map(
    compositeTypes.map((t) => [
      identifyCompositeType(t),
      {
        ...t,
        dependent_on: [],
        dependents: [],
        columns: t.columns.map((col) => ({
          ...col,
          dependent_on: [],
          dependents: [],
        })),
      },
    ]),
  );
}
