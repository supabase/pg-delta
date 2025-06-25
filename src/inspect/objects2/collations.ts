import type { Sql } from "postgres";

// PostgreSQL collation provider types
export type CollationProvider =
  /** default */
  | "d"
  /** libc */
  | "c"
  /** icu */
  | "i";

export interface InspectedCollation {
  schema: string;
  name: string;
  provider: CollationProvider;
  is_deterministic: boolean;
  encoding: number;
  collate: string;
  ctype: string;
  locale: string | null;
  icu_rules: string | null;
  version: string | null;
  owner: string;
}

export async function inspectCollations(
  sql: Sql,
): Promise<InspectedCollation[]> {
  const collations = await sql<InspectedCollation[]>`
with extension_oids as (
  select
    objid
  from
    pg_depend d
  where
    d.refclassid = 'pg_extension'::regclass
    and d.classid = 'pg_collation'::regclass
)
select
  n.nspname as schema,
  c.collname as name,
  c.collprovider as provider,
  c.collisdeterministic as is_deterministic,
  c.collencoding as encoding,
  c.collcollate as collate,
  c.collctype as ctype,
  c.colllocale as locale,
  c.collicurules as icu_rules,
  c.collversion as version,
  pg_get_userbyid(c.collowner) as owner
from
  pg_catalog.pg_collation c
  inner join pg_catalog.pg_namespace n on n.oid = c.collnamespace
  left outer join extension_oids e on c.oid = e.objid
  -- <EXCLUDE_INTERNAL>
  where n.nspname not in ('pg_internal', 'pg_catalog', 'information_schema', 'pg_toast')
  and n.nspname not like 'pg_temp_%' and n.nspname not like 'pg_toast_temp_%'
  and e.objid is null
  -- </EXCLUDE_INTERNAL>
order by
  1, 2;
  `;

  return collations;
}
