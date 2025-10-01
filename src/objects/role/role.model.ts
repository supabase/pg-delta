import type { Sql } from "postgres";
import z from "zod";
import { BasePgModel } from "../base.model.ts";

const rolePropsSchema = z.object({
  role_name: z.string(),
  is_superuser: z.boolean(),
  can_inherit: z.boolean(),
  can_create_roles: z.boolean(),
  can_create_databases: z.boolean(),
  can_login: z.boolean(),
  can_replicate: z.boolean(),
  connection_limit: z.number().nullable(),
  can_bypass_rls: z.boolean(),
  config: z.array(z.string()).nullable(),
  comment: z.string().nullable(),
});

export type RoleProps = z.infer<typeof rolePropsSchema>;

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
  public readonly comment: RoleProps["comment"];

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
    this.comment = props.comment;
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
      comment: this.comment,
    };
  }
}

export async function extractRoles(sql: Sql): Promise<Role[]> {
  return sql.begin(async (sql) => {
    await sql`set search_path = ''`;
    const roleRows = await sql`
with extension_role_oids as (
  select objid
  from pg_shdepend d
  where d.refclassid = 'pg_extension'::regclass
    and d.classid   = 'pg_authid'::regclass
),
extension_object_oids as (
  select classid, objid
  from pg_depend d
  where d.refclassid = 'pg_extension'::regclass
    and d.deptype    = 'e'
),
extension_grantee_roles as (
  select distinct g.grantee as role_oid
  from pg_init_privs p
  join extension_object_oids eo
    on eo.classid = p.classoid and eo.objid = p.objoid
  join lateral aclexplode(p.initprivs) as g on true
),
role_owned_objects as (
  select
    d.refobjid as role_oid,
    d.classid  as object_classid,
    d.objid    as object_oid,
    (ed.objid is not null) as is_extension_owned
  from pg_shdepend d
  left join pg_depend ed
    on ed.classid = d.classid
   and ed.objid   = d.objid
   and ed.refclassid = 'pg_extension'::regclass
   and ed.deptype    = 'e'
  where d.deptype    = 'o'  -- ownership dependency
    and d.refclassid = 'pg_authid'::regclass
),
roles_only_owning_extension_objects as (
  select role_oid
  from role_owned_objects
  group by role_oid
  having count(*) > 0 and bool_and(is_extension_owned)
)
select
  quote_ident(r.rolname) as role_name,
  r.rolsuper as is_superuser,
  r.rolinherit as can_inherit,
  r.rolcreaterole as can_create_roles,
  r.rolcreatedb as can_create_databases,
  r.rolcanlogin as can_login,
  r.rolreplication as can_replicate,
  r.rolconnlimit as connection_limit,
  r.rolbypassrls as can_bypass_rls,
  r.rolconfig as config,
  obj_description(r.oid, 'pg_authid') as comment
from
  pg_catalog.pg_roles r
  left outer join extension_role_oids e on r.oid = e.objid
where r.rolname not in ('postgres', 'pg_signal_backend', 'pg_read_all_settings', 'pg_read_all_stats', 'pg_stat_scan_tables', 'pg_monitor', 'pg_read_server_files', 'pg_write_server_files', 'pg_execute_server_program')
  and e.objid is null
  and r.oid not in (select role_oid from roles_only_owning_extension_objects)
  and r.oid not in (select role_oid from extension_grantee_roles)
order by
  1;
  `;
    // Validate and parse each row using the Zod schema
    const validatedRows = roleRows.map((row: unknown) =>
      rolePropsSchema.parse(row),
    );
    return validatedRows.map((row: RoleProps) => new Role(row));
  });
}
