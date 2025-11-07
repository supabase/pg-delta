import type { Sql } from "postgres";
import z from "zod";
import { BasePgModel } from "../base.model.ts";

const membershipInfoSchema = z.object({
  member: z.string(),
  grantor: z.string(),
  admin_option: z.boolean(),
  inherit_option: z.boolean().optional(),
  set_option: z.boolean().optional(),
});

const defaultPrivilegeSchema = z.object({
  in_schema: z.string().nullable(),
  objtype: z.enum(["r", "S", "f", "T", "n"]),
  grantee: z.string(),
  privileges: z.array(
    z.object({ privilege: z.string(), grantable: z.boolean() }),
  ),
});

const rolePropsSchema = z.object({
  name: z.string(),
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
  members: z.array(membershipInfoSchema),
  default_privileges: z.array(defaultPrivilegeSchema),
});

export type RoleProps = z.infer<typeof rolePropsSchema>;

export class Role extends BasePgModel {
  public readonly name: RoleProps["name"];
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
  public readonly members: RoleProps["members"];
  public readonly default_privileges: RoleProps["default_privileges"];

  constructor(props: RoleProps) {
    super();

    // Identity fields
    this.name = props.name;

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
    this.members = props.members;
    this.default_privileges = props.default_privileges;
  }

  get stableId(): `role:${string}` {
    return `role:${this.name}`;
  }

  get identityFields() {
    return {
      name: this.name,
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
      members: this.members,
      default_privileges: this.default_privileges,
    };
  }
}

export async function extractRoles(sql: Sql): Promise<Role[]> {
  return sql.begin(async (sql) => {
    await sql`set search_path = ''`;

    // Check PostgreSQL version capabilities for membership options
    const [capabilities] = await sql<
      { has_inherit: boolean; has_set: boolean }[]
    >`
      select
        exists (
          select 1
          from pg_attribute
          where attrelid = 'pg_auth_members'::regclass
            and attname = 'inherit_option'
        ) as has_inherit,
        exists (
          select 1
          from pg_attribute
          where attrelid = 'pg_auth_members'::regclass
            and attname = 'set_option'
        ) as has_set
    `;

    const roleRows =
      capabilities?.has_inherit && capabilities?.has_set
        ? await sql`
          WITH extension_role_oids AS (
            SELECT objid
            FROM pg_shdepend d
            WHERE d.refclassid = 'pg_extension'::regclass
              AND d.classid   = 'pg_authid'::regclass
          ),
          extension_object_oids AS (
            SELECT classid, objid
            FROM pg_depend d
            WHERE d.refclassid = 'pg_extension'::regclass
              AND d.deptype    = 'e'
          ),
          extension_grantee_roles AS (
            SELECT DISTINCT g.grantee AS role_oid
            FROM pg_init_privs p
            JOIN extension_object_oids eo
              ON eo.classid = p.classoid AND eo.objid = p.objoid
            JOIN LATERAL aclexplode(p.initprivs) AS g ON TRUE
          ),
          role_owned_objects AS (
            SELECT
              d.refobjid AS role_oid,
              d.classid  AS object_classid,
              d.objid    AS object_oid,
              (ed.objid IS NOT NULL) AS is_extension_owned
            FROM pg_shdepend d
            LEFT JOIN pg_depend ed
              ON ed.classid = d.classid
            AND ed.objid   = d.objid
            AND ed.refclassid = 'pg_extension'::regclass
            AND ed.deptype    = 'e'
            WHERE d.deptype    = 'o'  -- ownership dependency
              AND d.refclassid = 'pg_authid'::regclass
          ),
          roles_only_owning_extension_objects AS (
            SELECT role_oid
            FROM role_owned_objects
            GROUP BY role_oid
            HAVING COUNT(*) > 0 AND bool_and(is_extension_owned)
          ),
          role_memberships AS (
            SELECT 
              r.rolname AS role_name,
              json_agg(
                json_build_object(
                  'member', m.rolname,
                  'grantor', g.rolname,
                  'admin_option', am.admin_option,
                  'inherit_option', am.inherit_option,   -- PG16+
                  'set_option', am.set_option            -- PG16+
                )
              ) FILTER (WHERE m.rolname IS NOT NULL) AS members
            FROM pg_catalog.pg_roles r
            LEFT JOIN pg_auth_members am ON am.roleid = r.oid  -- roles that are members of this role
            LEFT JOIN pg_roles m ON m.oid = am.member
            LEFT JOIN pg_roles g ON g.oid = am.grantor
            GROUP BY r.rolname
          )
          SELECT
            quote_ident(r.rolname) AS name,
            r.rolsuper AS is_superuser,
            r.rolinherit AS can_inherit,
            r.rolcreaterole AS can_create_roles,
            r.rolcreatedb AS can_create_databases,
            r.rolcanlogin AS can_login,
            r.rolreplication AS can_replicate,
            r.rolconnlimit AS connection_limit,
            r.rolbypassrls AS can_bypass_rls,
            r.rolconfig AS config,
            obj_description(r.oid, 'pg_authid') AS comment,
            coalesce(rm.members, '[]') AS members,
            COALESCE(
              (
                SELECT json_agg(
                        json_build_object(
                          'in_schema',
                            CASE WHEN s.defaclnamespace = 0
                                  THEN NULL
                                  ELSE s.defaclnamespace::regnamespace::text
                            END,
                          'objtype', s.defaclobjtype,
                          'grantee',
                            CASE WHEN s.grantee = 0
                                  THEN 'PUBLIC'
                                  ELSE s.grantee::regrole::text
                            END,
                          'privileges', s.privileges
                        )
                        ORDER BY s.defaclnamespace NULLS FIRST,
                                  s.defaclobjtype,
                                  s.grantee
                      )
                FROM (
                  SELECT
                    d.defaclnamespace,
                    d.defaclobjtype,
                    x.grantee,
                    json_agg(
                      json_build_object(
                        'privilege', x.privilege_type,
                        'grantable', x.is_grantable
                      )
                      ORDER BY x.privilege_type, x.is_grantable
                    ) AS privileges
                  FROM pg_default_acl d
                  CROSS JOIN LATERAL aclexplode(COALESCE(d.defaclacl, ARRAY[]::aclitem[]))
                    AS x(grantor, grantee, privilege_type, is_grantable)
                  WHERE d.defaclrole = r.oid
                  GROUP BY d.defaclnamespace, d.defaclobjtype, x.grantee
                ) AS s
              ),
              '[]'
            ) AS default_privileges
          FROM pg_catalog.pg_roles r
          LEFT OUTER JOIN extension_role_oids e ON r.oid = e.objid
          LEFT JOIN role_memberships rm ON rm.role_name = r.rolname
          WHERE r.rolname NOT IN (
            'pg_checkpoint',
            'pg_create_subscription', -- PG16+
            'pg_database_owner',
            'pg_execute_server_program',
            'pg_maintain', -- PG17+
            'pg_monitor',
            'pg_read_all_data',
            'pg_read_all_settings',
            'pg_read_all_stats',
            'pg_read_server_files',
            'pg_signal_backend',
            'pg_stat_scan_tables',
            'pg_use_reserved_connections', -- PG16+
            'pg_write_all_data',
            'pg_write_server_files',
            'postgres'
          )
            AND e.objid IS NULL
            AND r.oid NOT IN (SELECT role_oid FROM roles_only_owning_extension_objects)
            AND r.oid NOT IN (SELECT role_oid FROM extension_grantee_roles)
          ORDER BY 1;
      `
        : await sql`
          -- PG15: columns inherit_option and set_option do not exist
          WITH extension_role_oids AS (
            SELECT objid
            FROM pg_shdepend d
            WHERE d.refclassid = 'pg_extension'::regclass
              AND d.classid   = 'pg_authid'::regclass
          ),
          extension_object_oids AS (
            SELECT classid, objid
            FROM pg_depend d
            WHERE d.refclassid = 'pg_extension'::regclass
              AND d.deptype    = 'e'
          ),
          extension_grantee_roles AS (
            SELECT DISTINCT g.grantee AS role_oid
            FROM pg_init_privs p
            JOIN extension_object_oids eo
              ON eo.classid = p.classoid AND eo.objid = p.objoid
            JOIN LATERAL aclexplode(p.initprivs) AS g ON true
          ),
          role_owned_objects AS (
            SELECT
              d.refobjid AS role_oid,
              d.classid  AS object_classid,
              d.objid    AS object_oid,
              (ed.objid IS NOT NULL) AS is_extension_owned
            FROM pg_shdepend d
            LEFT JOIN pg_depend ed
              ON ed.classid = d.classid
            AND ed.objid   = d.objid
            AND ed.refclassid = 'pg_extension'::regclass
            AND ed.deptype    = 'e'
            WHERE d.deptype    = 'o'  -- ownership dependency
              AND d.refclassid = 'pg_authid'::regclass
          ),
          roles_only_owning_extension_objects AS (
            SELECT role_oid
            FROM role_owned_objects
            GROUP BY role_oid
            HAVING COUNT(*) > 0 AND bool_and(is_extension_owned)
          ),
          role_memberships AS (
            SELECT 
              r.rolname AS role_name,
              json_agg(
                json_build_object(
                  'member', m.rolname,
                  'grantor', g.rolname,
                  'admin_option', am.admin_option
                )
              ) FILTER (WHERE m.rolname IS NOT NULL) AS members
            FROM pg_catalog.pg_roles r
            LEFT JOIN pg_auth_members am ON am.roleid = r.oid
            LEFT JOIN pg_roles m ON m.oid = am.member
            LEFT JOIN pg_roles g ON g.oid = am.grantor
            GROUP BY r.rolname
          )
          SELECT
            quote_ident(r.rolname) AS name,
            r.rolsuper AS is_superuser,
            r.rolinherit AS can_inherit,
            r.rolcreaterole AS can_create_roles,
            r.rolcreatedb AS can_create_databases,
            r.rolcanlogin AS can_login,
            r.rolreplication AS can_replicate,
            r.rolconnlimit AS connection_limit,
            r.rolbypassrls AS can_bypass_rls,
            r.rolconfig AS config,
            obj_description(r.oid, 'pg_authid') AS comment,
            coalesce(rm.members, '[]') AS members,
            COALESCE(
              (
                SELECT json_agg(
                        json_build_object(
                          'in_schema', CASE WHEN s.defaclnamespace = 0
                                            THEN NULL
                                            ELSE s.defaclnamespace::regnamespace::text
                                        END,
                          'objtype', s.defaclobjtype,
                          'grantee', CASE WHEN s.grantee = 0
                                          THEN 'PUBLIC'
                                          ELSE s.grantee::regrole::text
                                      END,
                          'privileges', s.privileges
                        )
                        ORDER BY s.defaclnamespace NULLS FIRST,
                                  s.defaclobjtype,
                                  s.grantee
                      )
                FROM (
                  SELECT
                    d.defaclnamespace,
                    d.defaclobjtype,
                    x.grantee,
                    json_agg(
                      json_build_object(
                        'privilege', x.privilege_type,
                        'grantable', x.is_grantable
                      )
                      ORDER BY x.privilege_type, x.is_grantable
                    ) AS privileges
                  FROM pg_default_acl d
                  CROSS JOIN LATERAL aclexplode(COALESCE(d.defaclacl, ARRAY[]::aclitem[]))
                    AS x(grantor, grantee, privilege_type, is_grantable)
                  WHERE d.defaclrole = r.oid
                  GROUP BY d.defaclnamespace, d.defaclobjtype, x.grantee
                ) AS s
              ),
              '[]'
            ) AS default_privileges
          FROM pg_catalog.pg_roles r
          LEFT OUTER JOIN extension_role_oids e ON r.oid = e.objid
          LEFT JOIN role_memberships rm ON rm.role_name = r.rolname
          WHERE r.rolname NOT IN (
            'pg_checkpoint',
            'pg_create_subscription', -- PG16+
            'pg_database_owner',
            'pg_execute_server_program',
            'pg_maintain', -- PG17+
            'pg_monitor',
            'pg_read_all_data',
            'pg_read_all_settings',
            'pg_read_all_stats',
            'pg_read_server_files',
            'pg_signal_backend',
            'pg_stat_scan_tables',
            'pg_use_reserved_connections', -- PG16+
            'pg_write_all_data',
            'pg_write_server_files',
            'postgres'
          )
            AND e.objid IS NULL
            AND r.oid NOT IN (SELECT role_oid FROM roles_only_owning_extension_objects)
            AND r.oid NOT IN (SELECT role_oid FROM extension_grantee_roles)
          ORDER BY 1;
      `;
    // Validate and parse each row using the Zod schema
    const validatedRows = roleRows.map((row: unknown) =>
      rolePropsSchema.parse(row),
    );
    return validatedRows.map((row: RoleProps) => new Role(row));
  });
}
