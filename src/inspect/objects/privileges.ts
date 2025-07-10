import type { Sql } from "postgres";

export interface InspectedPrivilege {
  role_name: string;
  is_superuser: boolean;
  can_inherit: boolean;
  can_create_roles: boolean;
  can_create_databases: boolean;
  can_login: boolean;
  can_replicate: boolean;
  connection_limit: number | null;
  can_bypass_rls: boolean;
  config: string[] | null;
}

function identifyPrivilege(priv: InspectedPrivilege): string {
  return priv.role_name;
}

export async function inspectPrivileges(
  sql: Sql,
): Promise<Map<string, InspectedPrivilege>> {
  const privileges = await sql<InspectedPrivilege[]>`
select
  rolname as role_name,
  rolsuper as is_superuser,
  rolinherit as can_inherit,
  rolcreaterole as can_create_roles,
  rolcreatedb as can_create_databases,
  rolcanlogin as can_login,
  rolreplication as can_replicate,
  rolconnlimit as connection_limit,
  rolbypassrls as can_bypass_rls,
  rolconfig as config
from
  pg_catalog.pg_roles
  -- <EXCLUDE_INTERNAL>
  where rolname not in ('postgres', 'pg_signal_backend', 'pg_read_all_settings', 'pg_read_all_stats', 'pg_stat_scan_tables', 'pg_monitor', 'pg_read_server_files', 'pg_write_server_files', 'pg_execute_server_program')
  -- </EXCLUDE_INTERNAL>
order by
  1;
  `;

  return new Map(privileges.map((p) => [identifyPrivilege(p), p]));
}
