import type { Sql } from "postgres";

export interface InspectedEnum {
  schema: string;
  name: string;
  sort_order: number;
  label: string;
  owner: string;
}

export async function inspectEnums(sql: Sql): Promise<InspectedEnum[]> {
  const enums = await sql<InspectedEnum[]>`
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
  e.enumsortorder as sort_order,
  e.enumlabel as label,
  pg_get_userbyid(t.typowner) as owner
from
  pg_catalog.pg_enum e
  inner join pg_catalog.pg_type t on t.oid = e.enumtypid
  inner join pg_catalog.pg_namespace n on n.oid = t.typnamespace
  left outer join extension_oids ext on t.oid = ext.objid
  -- <EXCLUDE_INTERNAL>
  where n.nspname not in ('pg_internal', 'pg_catalog', 'information_schema', 'pg_toast')
  and n.nspname not like 'pg_temp_%' and n.nspname not like 'pg_toast_temp_%'
  and ext.objid is null
  -- </EXCLUDE_INTERNAL>
order by
  1, 2, 3;
  `;

  return enums;
}
