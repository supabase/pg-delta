import type { Sql } from "postgres";

export interface InspectedDomain {
  schema: string;
  name: string;
  base_type: string;
  base_type_schema: string;
  not_null: boolean;
  type_modifier: number | null;
  array_dimensions: number | null;
  collation: string | null;
  default_bin: string | null;
  default_value: string | null;
  owner: string;
}

export async function inspectDomains(sql: Sql): Promise<InspectedDomain[]> {
  const domains = await sql<InspectedDomain[]>`
with extension_oids as (
  select
    objid
  from
    pg_depend d
  where
    d.refclassid = 'pg_extension'::regclass
    and d.classid = 'pg_type'::regclass
)
select
  n.nspname as schema,
  t.typname as name,
  bt.typname as base_type,
  bn.nspname as base_type_schema,
  t.typnotnull as not_null,
  t.typtypmod as type_modifier,
  t.typndims as array_dimensions,
  c.collname as collation,
  pg_get_expr(t.typdefaultbin, 0) as default_bin,
  t.typdefault as default_value,
  pg_get_userbyid(t.typowner) as owner
from
  pg_catalog.pg_type t
  inner join pg_catalog.pg_namespace n on n.oid = t.typnamespace
  inner join pg_catalog.pg_type bt on bt.oid = t.typbasetype
  inner join pg_catalog.pg_namespace bn on bn.oid = bt.typnamespace
  left join pg_catalog.pg_collation c on c.oid = t.typcollation
  left outer join extension_oids e on t.oid = e.objid
  -- <EXCLUDE_INTERNAL>
  where n.nspname not in ('pg_internal', 'pg_catalog', 'information_schema', 'pg_toast')
  and n.nspname not like 'pg_temp_%' and n.nspname not like 'pg_toast_temp_%'
  and e.objid is null
  and t.typtype = 'd'
  -- </EXCLUDE_INTERNAL>
order by
  1, 2;
  `;

  return domains;
}
