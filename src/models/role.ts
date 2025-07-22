import type { Sql } from "postgres";
import { BasePgModel } from "./base.ts";

interface RoleProps {
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

export class Role extends BasePgModel {
  public readonly role_name: RoleProps["role_name"];
  public readonly is_superuser: RoleProps["is_superuser"];
  public readonly can_inherit: RoleProps["can_inherit"];
  public readonly can_create_roles: RoleProps["can_create_roles"];
  public readonly can_create_databases: RoleProps["can_create_databases"];
  public readonly can_login: RoleProps["can_login"];
  public readonly can_replicate: RoleProps["can_replicate"];
  public readonly connection_limit: RoleProps["connection_limit"];
  public readonly can_bypass_rls: RoleProps["can_bypass_rls"];
  public readonly config: RoleProps["config"];

  constructor(props: RoleProps) {
    super();

    // Identity fields
    this.role_name = props.role_name;

    // Data fields
    this.is_superuser = props.is_superuser;
    this.can_inherit = props.can_inherit;
    this.can_create_roles = props.can_create_roles;
    this.can_create_databases = props.can_create_databases;
    this.can_login = props.can_login;
    this.can_replicate = props.can_replicate;
    this.connection_limit = props.connection_limit;
    this.can_bypass_rls = props.can_bypass_rls;
    this.config = props.config;
  }

  get stableId(): `role:${string}` {
    return `role:${this.role_name}`;
  }

  get identityFields() {
    return {
      role_name: this.role_name,
    };
  }

  get dataFields() {
    return {
      is_superuser: this.is_superuser,
      can_inherit: this.can_inherit,
      can_create_roles: this.can_create_roles,
      can_create_databases: this.can_create_databases,
      can_login: this.can_login,
      can_replicate: this.can_replicate,
      connection_limit: this.connection_limit,
      can_bypass_rls: this.can_bypass_rls,
      config: this.config,
    };
  }
}

export async function extractRoles(sql: Sql): Promise<Role[]> {
  const roleRows = await sql<RoleProps[]>`
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
  where rolname not in ('postgres', 'pg_signal_backend', 'pg_read_all_settings', 'pg_read_all_stats', 'pg_stat_scan_tables', 'pg_monitor', 'pg_read_server_files', 'pg_write_server_files', 'pg_execute_server_program')
order by
  1;
  `;
  return roleRows.map((row) => new Role(row));
}
