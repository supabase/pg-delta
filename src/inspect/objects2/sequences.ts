import type { Sql } from "postgres";

export interface InspectedSequence {
  schema: string;
  name: string;
  data_type: string;
  start_value: number;
  minimum_value: number;
  maximum_value: number;
  increment: number;
  cycle_option: boolean;
  cache_size: number;
  last_value: number | null;
  is_called: boolean;
  persistence: string;
  owner: string;
}

export async function inspectSequences(sql: Sql): Promise<InspectedSequence[]> {
  const sequences = await sql<InspectedSequence[]>`
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
  n.nspname as schema,
  c.relname as name,
  format_type(s.seqtypid, null) as data_type,
  s.seqstart as start_value,
  s.seqmin as minimum_value,
  s.seqmax as maximum_value,
  s.seqincrement as increment,
  s.seqcycle as cycle_option,
  s.seqcache as cache_size,
  s.seqlast as last_value,
  s.seqis_called as is_called,
  c.relpersistence as persistence,
  pg_get_userbyid(c.relowner) as owner
from
  pg_catalog.pg_class c
  inner join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  inner join pg_catalog.pg_sequence s on s.seqrelid = c.oid
  left outer join extension_oids e on c.oid = e.objid
  -- <EXCLUDE_INTERNAL>
  where n.nspname not in ('pg_internal', 'pg_catalog', 'information_schema', 'pg_toast')
  and n.nspname not like 'pg_temp_%' and n.nspname not like 'pg_toast_temp_%'
  and e.objid is null
  and c.relkind = 'S'
  -- </EXCLUDE_INTERNAL>
order by
  1, 2;
  `;

  return sequences;
}
