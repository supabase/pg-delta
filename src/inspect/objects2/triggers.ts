import type { Sql } from "postgres";

// PostgreSQL trigger enabled status
export type TriggerEnabled =
  /** enabled */
  | "O"
  /** disabled */
  | "D"
  /** replica */
  | "R"
  /** always */
  | "A";

export interface InspectedTrigger {
  schema: string;
  name: string;
  table_schema: string;
  table_name: string;
  function_schema: string;
  function_name: string;
  trigger_type: number;
  enabled: TriggerEnabled;
  is_internal: boolean;
  deferrable: boolean;
  initially_deferred: boolean;
  argument_count: number;
  column_numbers: number[] | null;
  arguments: string[];
  when_condition: string | null;
  old_table: string | null;
  new_table: string | null;
  owner: string;
}

export async function inspectTriggers(sql: Sql): Promise<InspectedTrigger[]> {
  const triggers = await sql<InspectedTrigger[]>`
with extension_oids as (
  select
    objid
  from
    pg_depend d
  where
    d.refclassid = 'pg_extension'::regclass
    and d.classid = 'pg_trigger'::regclass
)
select
  tn.nspname as schema,
  t.tgname as name,
  tn.nspname as table_schema,
  tc.relname as table_name,
  fn.nspname as function_schema,
  fc.proname as function_name,
  t.tgtype as trigger_type,
  t.tgenabled as enabled,
  t.tgisinternal as is_internal,
  t.tgdeferrable as deferrable,
  t.tginitdeferred as initially_deferred,
  t.tgnargs as argument_count,
  t.tgattr as column_numbers,
  case when t.tgnargs > 0 then array_fill(''::text, array[t.tgnargs]) else array[]::text[] end as arguments,
  pg_get_expr(t.tgqual, t.tgrelid) as when_condition,
  t.tgoldtable as old_table,
  t.tgnewtable as new_table,
  pg_get_userbyid(tc.relowner) as owner
from
  pg_catalog.pg_trigger t
  inner join pg_catalog.pg_class tc on tc.oid = t.tgrelid
  inner join pg_catalog.pg_namespace tn on tn.oid = tc.relnamespace
  inner join pg_catalog.pg_proc fc on fc.oid = t.tgfoid
  inner join pg_catalog.pg_namespace fn on fn.oid = fc.pronamespace
  left outer join extension_oids e on t.oid = e.objid
  -- <EXCLUDE_INTERNAL>
  where tn.nspname not in ('pg_internal', 'pg_catalog', 'information_schema', 'pg_toast')
  and tn.nspname not like 'pg_temp_%' and tn.nspname not like 'pg_toast_temp_%'
  and e.objid is null
  and not t.tgisinternal
  -- </EXCLUDE_INTERNAL>
order by
  1, 2;
  `;

  return triggers;
}
