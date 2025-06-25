import type { Sql } from "postgres";

export interface InspectedIndex {
  schema: string;
  name: string;
  table_schema: string;
  table_name: string;
  index_type: string;
  is_unique: boolean;
  is_primary: boolean;
  is_exclusion: boolean;
  nulls_not_distinct: boolean;
  immediate: boolean;
  key_columns: number[];
  included_columns: number[];
  column_options: number[];
  index_expressions: string | null;
  partial_predicate: string | null;
  owner: string;
}

export async function inspectIndexes(sql: Sql): Promise<InspectedIndex[]> {
  const indexes = await sql<InspectedIndex[]>`
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
  tn.nspname as table_schema,
  tc.relname as table_name,
  am.amname as index_type,
  i.indisunique as is_unique,
  i.indisprimary as is_primary,
  i.indisexclusion as is_exclusion,
  i.indnullsnotdistinct as nulls_not_distinct,
  i.indimmediate as immediate,
  i.indkey as key_columns,
  array(
    select generate_series(1, array_length(i.indkey, 1))
    except
    select unnest(i.indkey)
  ) as included_columns,
  i.indoption as column_options,
  pg_get_expr(i.indexprs, i.indrelid) as index_expressions,
  pg_get_expr(i.indpred, i.indrelid) as partial_predicate,
  pg_get_userbyid(c.relowner) as owner
from
  pg_catalog.pg_class c
  inner join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  inner join pg_catalog.pg_index i on i.indexrelid = c.oid
  inner join pg_catalog.pg_class tc on tc.oid = i.indrelid
  inner join pg_catalog.pg_namespace tn on tn.oid = tc.relnamespace
  inner join pg_catalog.pg_am am on am.oid = c.relam
  left outer join extension_oids e on c.oid = e.objid
  -- <EXCLUDE_INTERNAL>
  where n.nspname not in ('pg_internal', 'pg_catalog', 'information_schema', 'pg_toast')
  and n.nspname not like 'pg_temp_%' and n.nspname not like 'pg_toast_temp_%'
  and e.objid is null
  and c.relkind = 'i'
  -- </EXCLUDE_INTERNAL>
order by
  1, 2;
  `;

  return indexes;
}
