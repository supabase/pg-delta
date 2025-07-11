import type { Sql } from "postgres";
import type { DependentDatabaseObject } from "../types.ts";

// PostgreSQL relation persistence types
type RelationPersistence =
  /** Permanent relation (default) */
  | "p"
  /** Unlogged relation */
  | "u"
  /** Temporary relation */
  | "t";

// PostgreSQL replica identity types
export type ReplicaIdentity =
  /** DEFAULT */
  | "d"
  /** NOTHING */
  | "n"
  /** FULL */
  | "f"
  /** INDEX */
  | "i";

export interface InspectedColumnRow {
  name: string;
  position: number;
  data_type: string;
  data_type_str: string;
  is_enum: boolean;
  enum_schema: string | null;
  enum_name: string | null;
  not_null: boolean;
  is_identity: boolean;
  is_identity_always: boolean;
  is_generated: boolean;
  collation: string | null;
  default: string | null;
  comment: string | null;
}

export type InspectedColumn = InspectedColumnRow & DependentDatabaseObject;

interface InspectedTableRow {
  schema: string;
  name: string;
  persistence: RelationPersistence;
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
  parent_schema: string | null;
  parent_name: string | null;
  columns: InspectedColumnRow[];
}

export type InspectedTable = Omit<InspectedTableRow, "columns"> &
  DependentDatabaseObject & { columns: InspectedColumn[] };

export function identifyTable(
  table: Pick<InspectedTableRow, "schema" | "name">,
): string {
  return `${table.schema}.${table.name}`;
}

export async function inspectTables(
  sql: Sql,
): Promise<Map<string, InspectedTable>> {
  const tables = await sql<InspectedTableRow[]>`
with extension_oids as (
  select objid
  from pg_depend d
  where d.refclassid = 'pg_extension'::regclass
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
), tables as (
  select
    n.nspname as schema,
    c.relname as name,
    c.relpersistence as persistence,
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
    n_parent.nspname as parent_schema,
    c_parent.relname as parent_name,
    c.oid as oid
  from
    pg_class c
    inner join pg_namespace n on n.oid = c.relnamespace
    left join extension_oids e1 on c.oid = e1.objid
    left join pg_inherits i on i.inhrelid = c.oid
    left join pg_class c_parent on i.inhparent = c_parent.oid
    left join pg_namespace n_parent on c_parent.relnamespace = n_parent.oid
  where
    c.relkind in ('r', 'p')
    and n.nspname not in ('pg_internal', 'pg_catalog', 'information_schema', 'pg_toast')
    and n.nspname not like 'pg\_temp\_%'
    and n.nspname not like 'pg\_toast\_temp\_%'
    and e1.objid is null
)
select
  t.schema,
  t.name,
  t.persistence,
  t.row_security,
  t.force_row_security,
  t.has_indexes,
  t.has_rules,
  t.has_triggers,
  t.has_subclasses,
  t.is_populated,
  t.replica_identity,
  t.is_partition,
  t.options,
  t.partition_bound,
  t.owner,
  t.parent_schema,
  t.parent_name,
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
  tables t
  left join pg_attribute a on a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef ad on a.attrelid = ad.adrelid and a.attnum = ad.adnum
  left join enums e on a.atttypid = e.enum_oid
group by
  t.schema, t.name, t.persistence, t.row_security, t.force_row_security, t.has_indexes, t.has_rules, t.has_triggers, t.has_subclasses, t.is_populated, t.replica_identity, t.is_partition, t.options, t.partition_bound, t.owner, t.parent_schema, t.parent_name
order by
  t.schema, t.name;
  `;

  return new Map(
    tables.map((t) => [
      identifyTable(t),
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
