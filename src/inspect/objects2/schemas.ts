import type { Sql } from "postgres";

export interface InspectedSchema {
  schema: string;
  owner: string;
}

export async function inspectSchemas(sql: Sql) {
  const schemas = await sql<InspectedSchema[]>`
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
  nspname as schema,
  pg_get_userbyid(nspowner) as owner
from
  pg_catalog.pg_namespace
  left outer join extension_oids e on e.objid = oid
  -- <EXCLUDE_INTERNAL>
  where nspname not in ('pg_internal', 'pg_catalog', 'information_schema', 'pg_toast')
  and nspname not like 'pg_temp_%' and nspname not like 'pg_toast_temp_%'
  and e.objid is null
  -- </EXCLUDE_INTERNAL>
order by
  1;
  `;

  return schemas;
}
