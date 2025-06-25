import type { Sql } from "postgres";

// PostgreSQL RLS policy command types
export type RlsPolicyCommand =
  /** SELECT */
  | "r"
  /** INSERT */
  | "a"
  /** UPDATE */
  | "w"
  /** DELETE */
  | "d"
  /** ALL */
  | "*";

export interface InspectedRlsPolicy {
  schema: string;
  name: string;
  table_schema: string;
  table_name: string;
  command: RlsPolicyCommand;
  permissive: boolean;
  roles: string[];
  using_expression: string | null;
  with_check_expression: string | null;
  owner: string;
}

export async function inspectRlsPolicies(
  sql: Sql,
): Promise<InspectedRlsPolicy[]> {
  const policies = await sql<InspectedRlsPolicy[]>`
with extension_oids as (
  select
    objid
  from
    pg_depend d
  where
    d.refclassid = 'pg_extension'::regclass
    and d.classid = 'pg_policy'::regclass
)
select
  n.nspname as schema,
  p.polname as name,
  tn.nspname as table_schema,
  tc.relname as table_name,
  p.polcmd as command,
  p.polpermissive as permissive,
  array(
    select r.rolname
    from pg_roles r
    where r.oid = any(p.polroles)
  ) as roles,
  pg_get_expr(p.polqual, p.polrelid) as using_expression,
  pg_get_expr(p.polwithcheck, p.polrelid) as with_check_expression,
  pg_get_userbyid(tc.relowner) as owner
from
  pg_catalog.pg_policy p
  inner join pg_catalog.pg_class tc on tc.oid = p.polrelid
  inner join pg_catalog.pg_namespace tn on tn.oid = tc.relnamespace
  inner join pg_catalog.pg_namespace n on n.oid = tc.relnamespace
  left outer join extension_oids e on p.oid = e.objid
  -- <EXCLUDE_INTERNAL>
  where tn.nspname not in ('pg_internal', 'pg_catalog', 'information_schema', 'pg_toast')
  and tn.nspname not like 'pg_temp_%' and tn.nspname not like 'pg_toast_temp_%'
  and e.objid is null
  -- </EXCLUDE_INTERNAL>
order by
  1, 2;
  `;

  return policies;
}
