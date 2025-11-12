import type { Sql } from "postgres";

/**
 * Dependency type as defined in PostgreSQL's pg_depend.deptype.
 * n: normal
 * a: auto
 * i: internal
 */
type PgDependType = "n" | "a" | "i";

export interface PgDepend {
  dependent_stable_id: string;
  referenced_stable_id: string;
  /**
   * Dependency type as defined in PostgreSQL's pg_depend.deptype.
   *
   * - "n" (normal): Ordinary dependency — if the referenced object is dropped, the dependent object is also dropped automatically.
   *   Example: a table column depends on its table.
   * - "a" (auto): Automatically created dependency — the dependent object was created as a result of creating the referenced object,
   *   and should be dropped automatically when the referenced object is dropped, but not otherwise treated as a strong link.
   * - "i" (internal): Internal dependency — the dependent object is a low-level part of the referenced object and cannot be dropped
   *   without dropping the whole referenced object. Example: a table's toast table or an index that's part of a unique constraint.
   */
  deptype: PgDependType;
}

/**
 * Extract dependencies for privileges and memberships so that GRANT/REVOKE
 * operations are properly ordered with respect to their target objects/roles.
 *
 * Encodes edges like:
 *  - acl:<target>::grantee:<role> -> <target>
 *  - acl:<target>::grantee:<role> -> role:<role>
 *  - aclcol:table:<schema>.<name>::grantee:<role> -> table:<schema>.<name>
 *  - aclcol:... -> role:<role>
 *  - defacl:<grantor>:<objtype>:<scope>:grantee:<grantee> -> role:<grantor>
 *  - defacl:... -> role:<grantee>
 *  - defacl:... -> schema:<schema> (when scoped to a schema)
 *  - membership:<role>-><member> -> role:<role>
 *  - membership:<role>-><member> -> role:<member>
 */
async function extractPrivilegeAndMembershipDepends(
  sql: Sql,
): Promise<PgDepend[]> {
  const rows = await sql<PgDepend[]>`
with
  -- OBJECT PRIVILEGES (relations)
  extension_rel_oids as (
    select objid from pg_depend d
    where d.refclassid = 'pg_extension'::regclass and d.classid = 'pg_class'::regclass
  ),
  rel_acls as (
    select
      c.relkind,
      c.relnamespace::regnamespace::text as schema_name,
      c.relname as relname,
      case when x.grantee = 0 then 'PUBLIC' else x.grantee::regrole::text end as grantee
    from pg_catalog.pg_class c
    join lateral aclexplode(c.relacl) as x(grantor, grantee, privilege_type, is_grantable) on true
    left join extension_rel_oids e on e.objid = c.oid
    where c.relkind in ('r','p','v','m','S')
      and not c.relnamespace::regnamespace::text like any(array['pg\\_%','information\\_schema'])
      and e.objid is null
  ),
  rel_targets as (
    select
      case
        when relkind in ('r','p') then format('table:%I.%I', schema_name, relname)
        when relkind = 'v' then format('view:%I.%I', schema_name, relname)
        when relkind = 'm' then format('materializedView:%I.%I', schema_name, relname)
        when relkind = 'S' then format('sequence:%I.%I', schema_name, relname)
        else null
      end as target_stable_id,
      schema_name as target_schema,
      grantee
    from rel_acls
  ),

  -- OBJECT PRIVILEGES (schemas)
  extension_ns_oids as (
    select objid from pg_depend d
    where d.refclassid = 'pg_extension'::regclass and d.classid = 'pg_namespace'::regclass
  ),
  ns_acls as (
    select
      format('schema:%I', n.nspname) as schema_stable_id,
      n.nspname as schema_name,
      case when x.grantee = 0 then 'PUBLIC' else x.grantee::regrole::text end as grantee
    from pg_catalog.pg_namespace n
    join lateral aclexplode(n.nspacl) as x(grantor, grantee, privilege_type, is_grantable) on true
    left join extension_ns_oids e on e.objid = n.oid
    where not n.nspname like any(array['pg\\_%','information\\_schema'])
      and e.objid is null
  ),

  -- OBJECT PRIVILEGES (languages)
  extension_lang_oids as (
    select objid from pg_depend d
    where d.refclassid = 'pg_extension'::regclass and d.classid = 'pg_language'::regclass
  ),
  lang_acls as (
    select
      format('language:%I', l.lanname) as language_stable_id,
      NULL::text as language_schema,
      case when x.grantee = 0 then 'PUBLIC' else x.grantee::regrole::text end as grantee
    from pg_catalog.pg_language l
    join lateral aclexplode(l.lanacl) as x(grantor, grantee, privilege_type, is_grantable) on true
    left join extension_lang_oids e on e.objid = l.oid
    where l.lanname not in ('internal','c')
  ),

  -- OBJECT PRIVILEGES (routines)
  extension_proc_oids as (
    select objid from pg_depend d
    where d.refclassid = 'pg_extension'::regclass and d.classid = 'pg_proc'::regclass
  ),
  proc_acls as (
    select
      p.pronamespace::regnamespace::text as schema_name,
      p.proname as procname,
      p.prokind,
      case when x.grantee = 0 then 'PUBLIC' else x.grantee::regrole::text end as grantee,
      (select coalesce(string_agg(format_type(oid, null), ',' order by ord), '') from unnest(p.proargtypes) with ordinality as t(oid, ord)) as arg_types,
      trim(pg_catalog.pg_get_function_identity_arguments(p.oid)) as identity_arguments
    from pg_catalog.pg_proc p
    join lateral aclexplode(p.proacl) as x(grantor, grantee, privilege_type, is_grantable) on true
    left join extension_proc_oids e on e.objid = p.oid
    join pg_language l on l.oid = p.prolang
    where not p.pronamespace::regnamespace::text like any(array['pg\\_%','information\\_schema'])
      and e.objid is null
      and l.lanname not in ('c','internal')
  ),
  proc_targets as (
    select
      case
        when prokind = 'a' then format('aggregate:%I.%I(%s)', schema_name, procname, identity_arguments)
        else format('procedure:%I.%I(%s)', schema_name, procname, arg_types)
      end as target_stable_id,
      schema_name,
      grantee
    from proc_acls
  ),

  -- OBJECT PRIVILEGES (types/domains)
  extension_type_oids as (
    select objid from pg_depend d
    where d.refclassid = 'pg_extension'::regclass and d.classid = 'pg_type'::regclass
  ),
  type_acls as (
    select
      t.typtype,
      t.typnamespace::regnamespace::text as schema_name,
      t.typname as type_name,
      case when x.grantee = 0 then 'PUBLIC' else x.grantee::regrole::text end as grantee
    from pg_catalog.pg_type t
    join lateral aclexplode(t.typacl) as x(grantor, grantee, privilege_type, is_grantable) on true
    left join extension_type_oids e on e.objid = t.oid
    where not t.typnamespace::regnamespace::text like any(array['pg\\_%','information\\_schema'])
      and e.objid is null
      and t.typtype in ('d','e','r','c')
  ),
  type_targets as (
    select
      (case
        when typtype = 'd' then format('domain:%I.%I', schema_name, type_name)
        when typtype = 'e' then format('enum:%I.%I', schema_name, type_name)
        when typtype = 'r' then format('range:%I.%I', schema_name, type_name)
        when typtype = 'c' then format('compositeType:%I.%I', schema_name, type_name)
        else null
      end) as target_stable_id,
      schema_name,
      grantee
    from type_acls
  ),

  -- COLUMN PRIVILEGES
  rels as (
    select c.oid,
           c.relkind,
           c.relnamespace::regnamespace::text as schema_name,
           c.relname as relname
    from pg_catalog.pg_class c
    left join pg_depend de on de.classid='pg_class'::regclass and de.objid=c.oid and de.refclassid='pg_extension'::regclass
    where c.relkind in ('r','p','v','m')
      and not c.relnamespace::regnamespace::text like any(array['pg\\_%','information\\_schema'])
      and de.objid is null
  ),
  col_acls as (
    select
      format('table:%I.%I', r.schema_name, r.relname) as table_stable_id,
      r.schema_name as table_schema,
      case when x.grantee = 0 then 'PUBLIC' else x.grantee::regrole::text end as grantee
    from rels r
    join pg_attribute a on a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
    join lateral aclexplode(a.attacl) as x(grantor, grantee, privilege_type, is_grantable) on true
  ),

  -- DEFAULT PRIVILEGES
  defacls as (
    select
      format(
        'defacl:%s:%s:%s:grantee:%s',
        d.defaclrole::regrole::text,
        d.defaclobjtype::text,
        coalesce(format('schema:%s', d.defaclnamespace::regnamespace::text), 'global'),
        case when x.grantee = 0 then 'PUBLIC' else x.grantee::regrole::text end
      ) as defacl_stable_id,
      format('role:%s', d.defaclrole::regrole::text) as grantor_role_stable_id,
      format('role:%s', case when x.grantee = 0 then 'PUBLIC' else x.grantee::regrole::text end) as grantee_role_stable_id,
      case
        when d.defaclnamespace = 0 then null
        else format('schema:%s', d.defaclnamespace::regnamespace::text)
      end as schema_stable_id,
      case
        when d.defaclnamespace = 0 then null
        else d.defaclnamespace::regnamespace::text
      end as schema_name
    from pg_default_acl d
    cross join lateral aclexplode(coalesce(d.defaclacl, ARRAY[]::aclitem[])) as x(grantor, grantee, privilege_type, is_grantable)
  ),

  -- ROLE MEMBERSHIPS
  memberships as (
    select quote_ident(r.rolname) as role_name, m.rolname as member_name
    from pg_auth_members am
    join pg_roles r on r.oid = am.roleid
    join pg_roles m on m.oid = am.member
  )

select distinct
  dependent_stable_id,
  referenced_stable_id,
  deptype
from (
  select distinct
    format('acl:%s::grantee:%s', target_stable_id, grantee) as dependent_stable_id,
    target_stable_id as referenced_stable_id,
    'n'::char as deptype,
    target_schema as dep_schema,
    target_schema as ref_schema
  from rel_targets
  where target_stable_id is not null

  union all
  select distinct
    format('acl:%s::grantee:%s', target_stable_id, grantee) as dependent_stable_id,
    format('role:%s', grantee) as referenced_stable_id,
    'n'::char as deptype,
    target_schema as dep_schema,
    NULL::text as ref_schema
  from rel_targets
  where target_stable_id is not null

  union all
  select distinct
    format('acl:%s::grantee:%s', schema_stable_id, grantee) as dependent_stable_id,
    schema_stable_id as referenced_stable_id,
    'n'::char as deptype,
    schema_name as dep_schema,
    schema_name as ref_schema
  from ns_acls

  union all
  select distinct
    format('acl:%s::grantee:%s', schema_stable_id, grantee) as dependent_stable_id,
    format('role:%s', grantee) as referenced_stable_id,
    'n'::char as deptype,
    schema_name as dep_schema,
    NULL::text as ref_schema
  from ns_acls

  union all
  select distinct
    format('acl:%s::grantee:%s', language_stable_id, grantee) as dependent_stable_id,
    language_stable_id as referenced_stable_id,
    'n'::char as deptype,
    NULL::text as dep_schema,
    NULL::text as ref_schema
  from lang_acls

  union all
  select distinct
    format('acl:%s::grantee:%s', language_stable_id, grantee) as dependent_stable_id,
    format('role:%s', grantee) as referenced_stable_id,
    'n'::char as deptype,
    NULL::text as dep_schema,
    NULL::text as ref_schema
  from lang_acls

  union all
  select distinct
    format('acl:%s::grantee:%s', target_stable_id, grantee) as dependent_stable_id,
    target_stable_id as referenced_stable_id,
    'n'::char as deptype,
    schema_name as dep_schema,
    schema_name as ref_schema
  from proc_targets

  union all
  select distinct
    format('acl:%s::grantee:%s', target_stable_id, grantee) as dependent_stable_id,
    format('role:%s', grantee) as referenced_stable_id,
    'n'::char as deptype,
    schema_name as dep_schema,
    NULL::text as ref_schema
  from proc_targets

  union all
  select distinct
    format('acl:%s::grantee:%s', target_stable_id, grantee) as dependent_stable_id,
    target_stable_id as referenced_stable_id,
    'n'::char as deptype,
    schema_name as dep_schema,
    schema_name as ref_schema
  from type_targets
  where target_stable_id is not null

  union all
  select distinct
    format('acl:%s::grantee:%s', target_stable_id, grantee) as dependent_stable_id,
    format('role:%s', grantee) as referenced_stable_id,
    'n'::char as deptype,
    schema_name as dep_schema,
    NULL::text as ref_schema
  from type_targets
  where target_stable_id is not null

  union all
  select distinct
    format('aclcol:%s::grantee:%s', table_stable_id, grantee) as dependent_stable_id,
    table_stable_id as referenced_stable_id,
    'n'::char as deptype,
    table_schema as dep_schema,
    table_schema as ref_schema
  from col_acls

  union all
  select distinct
    format('aclcol:%s::grantee:%s', table_stable_id, grantee) as dependent_stable_id,
    format('role:%s', grantee) as referenced_stable_id,
    'n'::char as deptype,
    table_schema as dep_schema,
    NULL::text as ref_schema
  from col_acls

  union all
  select distinct
    defacl_stable_id as dependent_stable_id,
    grantor_role_stable_id as referenced_stable_id,
    'n'::char as deptype,
    schema_name as dep_schema,
    NULL::text as ref_schema
  from defacls

  union all
  select distinct
    defacl_stable_id as dependent_stable_id,
    grantee_role_stable_id as referenced_stable_id,
    'n'::char as deptype,
    schema_name as dep_schema,
    NULL::text as ref_schema
  from defacls

  union all
  select distinct
    defacl_stable_id as dependent_stable_id,
    schema_stable_id as referenced_stable_id,
    'n'::char as deptype,
    schema_name as dep_schema,
    schema_name as ref_schema
  from defacls
  where schema_stable_id is not null

  union all
  select distinct
    format('membership:%s->%s', role_name, member_name) as dependent_stable_id,
    format('role:%s', role_name) as referenced_stable_id,
    'n'::char as deptype,
    NULL::text as dep_schema,
    NULL::text as ref_schema
  from memberships

  union all
  select distinct
    format('membership:%s->%s', role_name, member_name) as dependent_stable_id,
    format('role:%s', member_name) as referenced_stable_id,
    'n'::char as deptype,
    NULL::text as dep_schema,
    NULL::text as ref_schema
  from memberships
) all_rows
where dependent_stable_id <> referenced_stable_id
  and NOT (
    COALESCE(dep_schema, '') LIKE ANY (ARRAY['pg\\_%','information\\_schema'])
  )
  `;

  return rows;
}

/**
 * Extract all dependencies from pg_depend, joining with pg_class for class names and applying user object filters.
 * @param sql - The SQL client.
 * @param params - Object containing arrays of OIDs for filtering (user_oids, user_namespace_oids, etc.)
 * @returns Array of dependency objects with class names.
 */
export async function extractDepends(sql: Sql): Promise<PgDepend[]> {
  const dependsRows = await sql<PgDepend[]>`
  WITH ids AS (
    -- only the objects that actually show up in dependencies (both sides)
    SELECT DISTINCT classid, objid, objsubid FROM pg_depend WHERE deptype IN ('n','a')
    UNION
    SELECT DISTINCT refclassid, refobjid, refobjsubid FROM pg_depend WHERE deptype IN ('n','a')
  ),
  objects AS (
    /* Schemas */
    SELECT 'pg_namespace'::regclass AS classid, n.oid AS objid, 0::int2 AS objsubid,
          n.nspname AS schema_name,
          format('schema:%I', n.nspname) AS stable_id
    FROM pg_namespace n
    JOIN ids i ON i.classid = 'pg_namespace'::regclass AND i.objid = n.oid AND COALESCE(i.objsubid,0) = 0

    UNION ALL
    /* Tables / Views / MViews / Sequences / Indexes / Composite types (pg_class) */
    SELECT 'pg_class'::regclass, c.oid, 0::int2,
          ns.nspname,
          CASE
            WHEN ns.nspname IN ('information_schema','pg_catalog','pg_toast') THEN
              CASE c.relkind
                WHEN 'r' THEN format('systemTable:%I.%I', ns.nspname, c.relname)
                WHEN 'v' THEN format('systemView:%I.%I', ns.nspname, c.relname)
                WHEN 'S' THEN format('systemSequence:%I.%I', ns.nspname, c.relname)
                WHEN 'i' THEN format('systemIndex:%I.%I.%I', ns.nspname, tbl.relname, c.relname)
                ELSE format('systemObject:%I.%I:%s', ns.nspname, c.relname, c.relkind::text)
              END
            ELSE
              CASE c.relkind
                WHEN 'r' THEN format('table:%I.%I', ns.nspname, c.relname)
                WHEN 'p' THEN format('table:%I.%I', ns.nspname, c.relname)
                WHEN 'v' THEN format('view:%I.%I', ns.nspname, c.relname)
                WHEN 'm' THEN format('materializedView:%I.%I', ns.nspname, c.relname)
                WHEN 'S' THEN format('sequence:%I.%I', ns.nspname, c.relname)
                WHEN 'i' THEN format('index:%I.%I.%I', ns.nspname, tbl.relname, c.relname)
                WHEN 'c' THEN format('compositeType:%I.%I', ns.nspname, c.relname)
                ELSE format('unknown:%s.%s', 'pg_class', c.oid::text)
              END
          END AS stable_id
    FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    LEFT JOIN pg_index idx ON idx.indexrelid = c.oid
    LEFT JOIN pg_class tbl ON tbl.oid = idx.indrelid
    JOIN ids i ON i.classid = 'pg_class'::regclass AND i.objid = c.oid AND COALESCE(i.objsubid,0) = 0

    UNION ALL
    /* Columns (so refobjsubid > 0 resolves to a column stable id) */
    SELECT 'pg_class'::regclass, a.attrelid, a.attnum,
          ns.nspname,
          format('column:%I.%I.%I', ns.nspname, c.relname, a.attname)
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    JOIN ids i ON i.classid = 'pg_class'::regclass AND i.objid = a.attrelid AND i.objsubid = a.attnum
    WHERE a.attnum > 0 AND NOT a.attisdropped

    UNION ALL
    /* Types (map row types back to their owning relation when applicable) */
    SELECT 'pg_type'::regclass, t.oid, 0::int2,
          COALESCE(rns.nspname, ns.nspname) AS schema_name,  -- prefer owning rel's schema if present
          CASE t.typtype
            WHEN 'd' THEN format('domain:%I.%I', ns.nspname, t.typname)
            WHEN 'e' THEN format('enum:%I.%I', ns.nspname, t.typname)
            WHEN 'r' THEN format('range:%I.%I', ns.nspname, t.typname)
            WHEN 'm' THEN format('multirange:%I.%I', ns.nspname, t.typname)

            WHEN 'c' THEN
              CASE
                /* Row type owned by a table / partitioned table / foreign table */
                WHEN r.oid IS NOT NULL AND r.relkind IN ('r','p','f') THEN
                  CASE
                    WHEN rns.nspname IN ('information_schema','pg_catalog','pg_toast')
                      THEN format('systemTable:%I.%I', rns.nspname, r.relname)
                    ELSE    format('table:%I.%I',       rns.nspname, r.relname)
                  END

                /* Row type owned by a view */
                WHEN r.oid IS NOT NULL AND r.relkind = 'v' THEN
                  CASE
                    WHEN rns.nspname IN ('information_schema','pg_catalog','pg_toast')
                      THEN format('systemView:%I.%I', rns.nspname, r.relname)
                    ELSE    format('view:%I.%I',       rns.nspname, r.relname)
                  END

                /* Row type owned by a materialized view */
                WHEN r.oid IS NOT NULL AND r.relkind = 'm' THEN
                  CASE
                    /* your pg_class system-branch uses systemObject for relkind m */
                    WHEN rns.nspname IN ('information_schema','pg_catalog','pg_toast')
                      THEN format('systemObject:%I.%I:%s', rns.nspname, r.relname, 'm')
                    ELSE    format('materializedView:%I.%I', rns.nspname, r.relname)
                  END

                /* Standalone composite type */
                ELSE format('compositeType:%I.%I', ns.nspname, t.typname)
              END

            WHEN 'p' THEN format('pseudoType:%I.%I', ns.nspname, t.typname)
            ELSE         format('type:%I.%I',       ns.nspname, t.typname)
          END AS stable_id
    FROM pg_type t
    JOIN pg_namespace ns ON ns.oid = t.typnamespace
    LEFT JOIN pg_class     r   ON r.oid  = t.typrelid
    LEFT JOIN pg_namespace rns ON rns.oid = r.relnamespace
    JOIN ids i ON i.classid = 'pg_type'::regclass AND i.objid = t.oid AND COALESCE(i.objsubid,0) = 0

    UNION ALL
    /* Constraints on domain */
    SELECT 'pg_constraint'::regclass, c.oid, 0::int2,
          ns.nspname,
          format('constraint:%I.%I.%I', ns.nspname, ty.typname, c.conname)
    FROM pg_constraint c
    JOIN pg_type ty ON ty.oid = c.contypid
    JOIN pg_namespace ns ON ns.oid = ty.typnamespace
    JOIN ids i ON i.classid = 'pg_constraint'::regclass AND i.objid = c.oid AND COALESCE(i.objsubid,0) = 0
    WHERE c.contypid <> 0

    UNION ALL
    /* Constraints on table */
    SELECT 'pg_constraint'::regclass, c.oid, 0::int2,
          ns.nspname,
          format('constraint:%I.%I.%I', ns.nspname, tbl.relname, c.conname)
    FROM pg_constraint c
    JOIN pg_class tbl ON tbl.oid = c.conrelid
    JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
    JOIN ids i ON i.classid = 'pg_constraint'::regclass AND i.objid = c.oid AND COALESCE(i.objsubid,0) = 0
    WHERE c.conrelid <> 0

    UNION ALL
    /* RLS policies */
    SELECT 'pg_policy'::regclass, p.oid, 0::int2,
          ns.nspname,
          format('rlsPolicy:%I.%I.%I', ns.nspname, tbl.relname, p.polname)
    FROM pg_policy p
    JOIN pg_class tbl ON tbl.oid = p.polrelid
    JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
    JOIN ids i ON i.classid = 'pg_policy'::regclass AND i.objid = p.oid AND COALESCE(i.objsubid,0) = 0

    UNION ALL
    /* Functions/Procedures/Aggregates: types-only signature */
    SELECT 'pg_proc'::regclass, p.oid, 0::int2,
          ns.nspname,
          CASE
            WHEN p.prokind = 'a' THEN format(
              'aggregate:%I.%I(%s)',
              ns.nspname,
              p.proname,
              trim(pg_catalog.pg_get_function_identity_arguments(p.oid))
            )
            ELSE format(
              'procedure:%I.%I(%s)',
              ns.nspname,
              p.proname,
              COALESCE((
                SELECT string_agg(format_type(t.oid, NULL), ',' ORDER BY ord)
                FROM unnest(p.proargtypes) WITH ORDINALITY AS t(oid, ord)
              ), '')
            )
          END
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
    JOIN ids i ON i.classid = 'pg_proc'::regclass AND i.objid = p.oid AND COALESCE(i.objsubid,0) = 0

    UNION ALL
    /* Triggers */
    SELECT 'pg_trigger'::regclass, tg.oid, 0::int2,
          ns.nspname,
          format('trigger:%I.%I.%I', ns.nspname, tbl.relname, tg.tgname)
    FROM pg_trigger tg
    JOIN pg_class tbl ON tbl.oid = tg.tgrelid
    JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
    JOIN ids i ON i.classid = 'pg_trigger'::regclass AND i.objid = tg.oid AND COALESCE(i.objsubid,0) = 0

    UNION ALL
    /* Rewrite rules */
    SELECT 'pg_rewrite'::regclass, r.oid, 0::int2,
          ns.nspname,
          format('rule:%I.%I.%I', ns.nspname, tbl.relname, r.rulename)
    FROM pg_rewrite r
    JOIN pg_class tbl ON tbl.oid = r.ev_class
    JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
    JOIN ids i ON i.classid = 'pg_rewrite'::regclass AND i.objid = r.oid AND COALESCE(i.objsubid,0) = 0

    UNION ALL
    /* Full-text search objects */
    SELECT 'pg_ts_config'::regclass, c.oid, 0::int2, ns.nspname, format('tsConfig:%I.%I', ns.nspname, c.cfgname)
    FROM pg_ts_config c
    JOIN pg_namespace ns ON ns.oid = c.cfgnamespace
    JOIN ids i ON i.classid = 'pg_ts_config'::regclass AND i.objid = c.oid AND COALESCE(i.objsubid,0) = 0

    UNION ALL
    SELECT 'pg_ts_dict'::regclass, d.oid, 0::int2, ns.nspname, format('tsDict:%I.%I', ns.nspname, d.dictname)
    FROM pg_ts_dict d
    JOIN pg_namespace ns ON ns.oid = d.dictnamespace
    JOIN ids i ON i.classid = 'pg_ts_dict'::regclass AND i.objid = d.oid AND COALESCE(i.objsubid,0) = 0

    UNION ALL
    SELECT 'pg_ts_template'::regclass, t.oid, 0::int2, ns.nspname, format('tsTemplate:%I.%I', ns.nspname, t.tmplname)
    FROM pg_ts_template t
    JOIN pg_namespace ns ON ns.oid = t.tmplnamespace
    JOIN ids i ON i.classid = 'pg_ts_template'::regclass AND i.objid = t.oid AND COALESCE(i.objsubid,0) = 0

    UNION ALL
    /* Column defaults (attrdef) → column stable id */
    SELECT 'pg_attrdef'::regclass, ad.oid, 0::int2,
          ns.nspname,
          format('column:%I.%I.%I', ns.nspname, tbl.relname, col.attname)
    FROM pg_attrdef ad
    JOIN pg_class tbl ON tbl.oid = ad.adrelid
    JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
    JOIN pg_attribute col
      ON col.attrelid = ad.adrelid AND col.attnum = ad.adnum AND col.attnum > 0 AND NOT col.attisdropped
    JOIN ids i ON i.classid = 'pg_attrdef'::regclass AND i.objid = ad.oid AND COALESCE(i.objsubid,0) = 0

    UNION ALL
    /* Default ACLs */
    SELECT 'pg_default_acl'::regclass, da.oid, 0::int2,
          ns.nspname,
          format('defaultAcl:%I.%s', ns.nspname, da.defaclobjtype::text)
    FROM pg_default_acl da
    JOIN pg_namespace ns ON ns.oid = da.defaclnamespace
    JOIN ids i ON i.classid = 'pg_default_acl'::regclass AND i.objid = da.oid AND COALESCE(i.objsubid,0) = 0

    UNION ALL
    /* Publications */
    SELECT 'pg_publication'::regclass, p.oid, 0::int2,
          NULL::text,
          format('publication:%I', p.pubname)
    FROM pg_publication p
    JOIN ids i ON i.classid = 'pg_publication'::regclass AND i.objid = p.oid AND COALESCE(i.objsubid,0) = 0

    UNION ALL
    /* Publication–table membership rows (collapse to publication stable id) */
    SELECT 'pg_publication_rel'::regclass, pr.oid, 0::int2,
           NULL::text AS schema_name, -- publication isn’t really “in” a schema
           format('publication:%I', pub.pubname) AS stable_id
    FROM pg_publication_rel pr
    JOIN pg_publication pub ON pub.oid = pr.prpubid
    JOIN ids i ON i.classid = 'pg_publication_rel'::regclass
              AND i.objid   = pr.oid
              AND COALESCE(i.objsubid,0) = 0
              
    UNION ALL
    /* Language (no schema), Event trigger, Extension */
    SELECT 'pg_language'::regclass, l.oid, 0::int2, NULL::text, format('language:%I', l.lanname)
    FROM pg_language l
    JOIN ids i ON i.classid = 'pg_language'::regclass AND i.objid = l.oid AND COALESCE(i.objsubid,0) = 0

    UNION ALL
    SELECT 'pg_event_trigger'::regclass, et.oid, 0::int2, NULL::text, format('eventTrigger:%I', et.evtname)
    FROM pg_event_trigger et
    JOIN ids i ON i.classid = 'pg_event_trigger'::regclass AND i.objid = et.oid AND COALESCE(i.objsubid,0) = 0

    UNION ALL
    SELECT 'pg_extension'::regclass, e.oid, 0::int2, NULL::text, format('extension:%I', e.extname)
    FROM pg_extension e
    JOIN ids i ON i.classid = 'pg_extension'::regclass AND i.objid = e.oid AND COALESCE(i.objsubid,0) = 0

    UNION ALL
    /* Subscriptions (cluster-wide; scope to current database) */
    SELECT 'pg_subscription'::regclass, s.oid, 0::int2,
          NULL::text,
          format('subscription:%I', s.subname)
    FROM pg_subscription s
    JOIN ids i
      ON i.classid = 'pg_subscription'::regclass
     AND i.objid = s.oid
     AND COALESCE(i.objsubid,0) = 0
    WHERE s.subdbid = (SELECT oid FROM pg_database WHERE datname = current_database())
  ),
  base AS (
    SELECT DISTINCT
      COALESCE(dep.stable_id, format('unknown:%s.%s', (d.classid::regclass)::text, d.objid::text)) AS dependent_stable_id,
      COALESCE(ref.stable_id, format('unknown:%s.%s', (d.refclassid::regclass)::text, d.refobjid::text)) AS referenced_stable_id,
      d.deptype,
      dep.schema_name AS dep_schema,
      ref.schema_name AS ref_schema
    FROM pg_depend d
    LEFT JOIN objects dep
      ON dep.classid = d.classid AND dep.objid = d.objid AND dep.objsubid = COALESCE(NULLIF(d.objsubid,0),0)
    LEFT JOIN objects ref
      ON ref.classid = d.refclassid AND ref.objid = d.refobjid AND ref.objsubid = COALESCE(NULLIF(d.refobjsubid,0),0)
    WHERE d.deptype IN ('n','a')
  ),
  comment_deps AS (
    -- Table comments
    SELECT DISTINCT
      format('comment:%s', format('table:%I.%I', n.nspname, c.relname))                AS dependent_stable_id,
      format('table:%I.%I',   n.nspname, c.relname)                                    AS referenced_stable_id,
      'a'::"char" AS deptype,
      n.nspname AS dep_schema,
      n.nspname AS ref_schema
    FROM pg_description d
    JOIN pg_class c ON d.classoid = 'pg_class'::regclass AND d.objoid = c.oid AND d.objsubid = 0
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE c.relkind IN ('r','p')

    UNION ALL

    -- Materialized view comments
    SELECT DISTINCT
      format(
        'comment:%s',
        format('materializedView:%I.%I', n.nspname, c.relname)
      )                                                                                AS dependent_stable_id,
      format('materializedView:%I.%I', n.nspname, c.relname)                           AS referenced_stable_id,
      'a'::"char" AS deptype,
      n.nspname AS dep_schema,
      n.nspname AS ref_schema
    FROM pg_description d
    JOIN pg_class c ON d.classoid = 'pg_class'::regclass AND d.objoid = c.oid AND d.objsubid = 0
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE c.relkind = 'm'

    UNION ALL

    -- Composite type comments
    SELECT DISTINCT
      format(
        'comment:%s',
        format('compositeType:%I.%I', n.nspname, t.relname)
      )                                                                                AS dependent_stable_id,
      format('compositeType:%I.%I', n.nspname, t.relname)                              AS referenced_stable_id,
      'a'::"char" AS deptype,
      n.nspname AS dep_schema,
      n.nspname AS ref_schema
    FROM pg_description d
    JOIN pg_type ty
      ON d.classoid = 'pg_type'::regclass
     AND d.objoid   = ty.oid
     AND d.objsubid = 0
    JOIN pg_class t
      ON t.reltype = ty.oid
    JOIN pg_namespace n
      ON n.oid = t.relnamespace
    WHERE t.relkind = 'c'

    UNION ALL

    -- Domain comments
    SELECT DISTINCT
      format(
        'comment:%s',
        format('domain:%I.%I', t.typnamespace::regnamespace::text, t.typname)
      )                                                                                AS dependent_stable_id,
      format('domain:%I.%I',  t.typnamespace::regnamespace::text, t.typname)            AS referenced_stable_id,
      'a'::"char" AS deptype,
      t.typnamespace::regnamespace::text AS dep_schema,
      t.typnamespace::regnamespace::text AS ref_schema
    FROM pg_description d
    JOIN pg_type t ON d.classoid = 'pg_type'::regclass AND d.objoid = t.oid AND t.typtype = 'd' AND d.objsubid = 0
    

    UNION ALL

    -- Collation comments
    SELECT DISTINCT
      format(
        'comment:%s',
        format('collation:%I.%I', n.nspname, c.collname)
      )                                                                                AS dependent_stable_id,
      format('collation:%I.%I', n.nspname, c.collname)                                  AS referenced_stable_id,
      'a'::"char" AS deptype,
      n.nspname AS dep_schema,
      n.nspname AS ref_schema
    FROM pg_description d
    JOIN pg_collation c ON d.classoid = 'pg_collation'::regclass AND d.objoid = c.oid AND d.objsubid = 0
    JOIN pg_namespace n ON c.collnamespace = n.oid
    

    UNION ALL

    -- Enum type comments
    SELECT DISTINCT
      format(
        'comment:%s',
        format('enum:%I.%I', t.typnamespace::regnamespace::text, t.typname)
      )                                                                                AS dependent_stable_id,
      format('enum:%I.%I',    t.typnamespace::regnamespace::text, t.typname)            AS referenced_stable_id,
      'a'::"char" AS deptype,
      t.typnamespace::regnamespace::text AS dep_schema,
      t.typnamespace::regnamespace::text AS ref_schema
    FROM pg_description d
    JOIN pg_type t ON d.classoid = 'pg_type'::regclass AND d.objoid = t.oid AND t.typtype = 'e' AND d.objsubid = 0
    

    UNION ALL

    -- Range type comments
    SELECT DISTINCT
      format(
        'comment:%s',
        format('range:%I.%I', t.typnamespace::regnamespace::text, t.typname)
      )                                                                                AS dependent_stable_id,
      format('range:%I.%I',   t.typnamespace::regnamespace::text, t.typname)            AS referenced_stable_id,
      'a'::"char" AS deptype,
      t.typnamespace::regnamespace::text AS dep_schema,
      t.typnamespace::regnamespace::text AS ref_schema
    FROM pg_description d
    JOIN pg_type t ON d.classoid = 'pg_type'::regclass AND d.objoid = t.oid AND t.typtype = 'r' AND d.objsubid = 0
    

    UNION ALL

    -- Column comments (reference table as the owning object)
    SELECT DISTINCT
      format(
        'comment:%s',
        format('column:%I.%I.%I', n.nspname, c.relname, a.attname)
      )                                                                                AS dependent_stable_id,
      format('column:%I.%I.%I', n.nspname, c.relname, a.attname)                       AS referenced_stable_id,
      'a'::"char" AS deptype,
      n.nspname AS dep_schema,
      n.nspname AS ref_schema
    FROM pg_description d
    JOIN pg_class c ON d.classoid = 'pg_class'::regclass AND d.objoid = c.oid AND d.objsubid > 0
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = d.objsubid AND a.attnum > 0 AND NOT a.attisdropped
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE c.relkind IN ('r','p')

    UNION ALL

    -- Index comments
    SELECT DISTINCT
      format(
        'comment:%s',
        format('index:%I.%I.%I', n.nspname, tbl.relname, c.relname)
      )                                                                                AS dependent_stable_id,
      format('index:%I.%I.%I', n.nspname, tbl.relname, c.relname)                     AS referenced_stable_id,
      'a'::"char" AS deptype,
      n.nspname AS dep_schema,
      n.nspname AS ref_schema
    FROM pg_description d
    JOIN pg_class c ON d.classoid = 'pg_class'::regclass AND d.objoid = c.oid AND d.objsubid = 0
    JOIN pg_namespace n ON c.relnamespace = n.oid
    LEFT JOIN pg_index idx ON idx.indexrelid = c.oid
    LEFT JOIN pg_class tbl ON tbl.oid = idx.indrelid
    WHERE c.relkind = 'i'

    UNION ALL

    -- Materialized view column comments (reference materialized view as the owning object)
    SELECT DISTINCT
      format(
        'comment:%s',
        format('column:%I.%I.%I', n.nspname, c.relname, a.attname)
      )                                                                                AS dependent_stable_id,
      format('column:%I.%I.%I', n.nspname, c.relname, a.attname)                       AS referenced_stable_id,
      'a'::"char" AS deptype,
      n.nspname AS dep_schema,
      n.nspname AS ref_schema
    FROM pg_description d
    JOIN pg_class c ON d.classoid = 'pg_class'::regclass AND d.objoid = c.oid AND d.objsubid > 0
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = d.objsubid AND a.attnum > 0 AND NOT a.attisdropped
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE c.relkind = 'm'

    UNION ALL

    -- Composite type attribute comments
    SELECT DISTINCT
      format(
        'comment:%s',
        format('%s:%s', format('compositeType:%I.%I', n.nspname, t.relname), a.attname)
      )                                                                                AS dependent_stable_id,
      format('%s:%s', format('compositeType:%I.%I', n.nspname, t.relname), a.attname)  AS referenced_stable_id,
      'a'::"char" AS deptype,
      n.nspname AS dep_schema,
      n.nspname AS ref_schema
    FROM pg_description d
    JOIN pg_class t ON d.classoid = 'pg_class'::regclass AND d.objoid = t.oid AND t.relkind = 'c'
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.objsubid AND a.attnum > 0 AND NOT a.attisdropped
    JOIN pg_namespace n ON t.relnamespace = n.oid
    

    UNION ALL

    -- Language comments
    SELECT DISTINCT
      format('comment:%s', format('language:%I', l.lanname))                      AS dependent_stable_id,
      format('language:%I', l.lanname)                                            AS referenced_stable_id,
      'a'::"char" AS deptype,
      NULL::text AS dep_schema,
      NULL::text AS ref_schema
    FROM pg_description d
    JOIN pg_language l ON d.classoid = 'pg_language'::regclass AND d.objoid = l.oid AND d.objsubid = 0
    WHERE l.lanname NOT IN ('internal', 'c')
    UNION ALL

    -- Event trigger comments
    SELECT DISTINCT
      format('comment:%s', format('eventTrigger:%I', et.evtname))                 AS dependent_stable_id,
      format('eventTrigger:%I', et.evtname)                                       AS referenced_stable_id,
      'a'::"char" AS deptype,
      NULL::text AS dep_schema,
      NULL::text AS ref_schema
    FROM pg_description d
    JOIN pg_event_trigger et ON d.classoid = 'pg_event_trigger'::regclass AND d.objoid = et.oid AND d.objsubid = 0

    UNION ALL

    -- Publication comments
    SELECT DISTINCT
      format('comment:%s', format('publication:%I', p.pubname)) AS dependent_stable_id,
      format('publication:%I', p.pubname)                       AS referenced_stable_id,
      'a'::"char" AS deptype,
      NULL::text AS dep_schema,
      NULL::text AS ref_schema
    FROM pg_description d
    JOIN pg_publication p
      ON d.classoid = 'pg_publication'::regclass
     AND d.objoid = p.oid
     AND d.objsubid = 0

    UNION ALL

    -- Subscription comments
    SELECT DISTINCT
      format('comment:%s', format('subscription:%I', s.subname)) AS dependent_stable_id,
      format('subscription:%I', s.subname)                       AS referenced_stable_id,
      'a'::"char" AS deptype,
      NULL::text AS dep_schema,
      NULL::text AS ref_schema
    FROM pg_description d
    JOIN pg_subscription s
      ON d.classoid = 'pg_subscription'::regclass
     AND d.objoid = s.oid
     AND d.objsubid = 0
    WHERE s.subdbid = (SELECT oid FROM pg_database WHERE datname = current_database())

    UNION ALL

    -- Extension comments
    SELECT DISTINCT
      format('comment:%s', format('extension:%I', e.extname))                     AS dependent_stable_id,
      format('extension:%I', e.extname)                                           AS referenced_stable_id,
      'a'::"char" AS deptype,
      NULL::text AS dep_schema,
      NULL::text AS ref_schema
    FROM pg_description d
    JOIN pg_extension e ON d.classoid = 'pg_extension'::regclass AND d.objoid = e.oid AND d.objsubid = 0

    UNION ALL

    -- Procedure/function/aggregate comments
    SELECT DISTINCT
      CASE
        WHEN p.prokind = 'a' THEN format(
          'comment:%s',
          format(
            'aggregate:%I.%I(%s)',
            p.pronamespace::regnamespace::text,
            p.proname,
            trim(pg_catalog.pg_get_function_identity_arguments(p.oid))
          )
        )
        ELSE format(
          'comment:%s',
          format(
            'procedure:%I.%I(%s)',
            p.pronamespace::regnamespace::text,
            p.proname,
            coalesce(
              (select string_agg(format_type(oid, null), ',' order by ord) from unnest(p.proargtypes) with ordinality as t(oid, ord)),
              ''
            )
          )
        )
      END AS dependent_stable_id,
      CASE
        WHEN p.prokind = 'a' THEN format(
          'aggregate:%I.%I(%s)',
          p.pronamespace::regnamespace::text,
          p.proname,
          trim(pg_catalog.pg_get_function_identity_arguments(p.oid))
        )
        ELSE format(
          'procedure:%I.%I(%s)',
          p.pronamespace::regnamespace::text,
          p.proname,
          coalesce(
            (select string_agg(format_type(oid, null), ',' order by ord) from unnest(p.proargtypes) with ordinality as t(oid, ord)),
            ''
          )
        )
      END AS referenced_stable_id,
      'a'::"char" AS deptype,
      p.pronamespace::regnamespace::text AS dep_schema,
      p.pronamespace::regnamespace::text AS ref_schema
    FROM pg_description d
    JOIN pg_proc p ON d.classoid = 'pg_proc'::regclass AND d.objoid = p.oid AND d.objsubid = 0
    

    UNION ALL

    -- RLS policy comments
    SELECT DISTINCT
      format(
        'comment:%s',
        format('rlsPolicy:%I.%I.%I', ns.nspname, tc.relname, pol.polname)
      )                                                                                AS dependent_stable_id,
      format('rlsPolicy:%I.%I.%I', ns.nspname, tc.relname, pol.polname)            AS referenced_stable_id,
      'a'::"char" AS deptype,
      ns.nspname AS dep_schema,
      ns.nspname AS ref_schema
    FROM pg_description d
    JOIN pg_policy pol ON d.classoid = 'pg_policy'::regclass AND d.objoid = pol.oid AND d.objsubid = 0
    JOIN pg_class tc ON pol.polrelid = tc.oid
    JOIN pg_namespace ns ON tc.relnamespace = ns.oid
    

    UNION ALL

    -- Role comments
    SELECT DISTINCT
      format('comment:%s', format('role:%I', r.rolname))                          AS dependent_stable_id,
      format('role:%I', r.rolname)                                                AS referenced_stable_id,
      'a'::"char" AS deptype,
      NULL::text AS dep_schema,
      NULL::text AS ref_schema
    FROM pg_description d
    JOIN pg_roles r ON d.classoid = 'pg_authid'::regclass AND d.objoid = r.oid AND d.objsubid = 0

    UNION ALL

    -- Constraint comments
    SELECT DISTINCT
      format(
        'comment:%s',
        format('constraint:%I.%I.%I', ns.nspname, tbl.relname, con.conname)
      )                                                                                AS dependent_stable_id,
      format('constraint:%I.%I.%I', ns.nspname, tbl.relname, con.conname)          AS referenced_stable_id,
      'a'::"char" AS deptype,
      ns.nspname AS dep_schema,
      ns.nspname AS ref_schema
    FROM pg_description d
    JOIN pg_constraint con ON d.classoid = 'pg_constraint'::regclass AND d.objoid = con.oid
    JOIN pg_class tbl ON con.conrelid = tbl.oid
    JOIN pg_namespace ns ON tbl.relnamespace = ns.oid
    WHERE con.conrelid <> 0
  ),
  type_usage_deps AS (
    -- Composite type attribute dependencies on user-defined types (domain/enum/range/multirange/composite)
    SELECT DISTINCT
      format('compositeType:%I.%I', ns.nspname, comp.relname) AS dependent_stable_id,
      CASE ref_t.typtype
        WHEN 'd' THEN format('domain:%I.%I',      refns.nspname, ref_t.typname)
        WHEN 'e' THEN format('enum:%I.%I',        refns.nspname, ref_t.typname)
        WHEN 'r' THEN format('range:%I.%I',       refns.nspname, ref_t.typname)
        WHEN 'm' THEN format('multirange:%I.%I',  refns.nspname, ref_t.typname)
        WHEN 'c' THEN format('compositeType:%I.%I', refns.nspname, ref_comp.relname)
        ELSE NULL
      END AS referenced_stable_id,
      'n'::"char" AS deptype,
      ns.nspname AS dep_schema,
      refns.nspname AS ref_schema
    FROM pg_class comp
    JOIN pg_namespace ns ON ns.oid = comp.relnamespace
    JOIN pg_attribute a ON a.attrelid = comp.oid AND a.attnum > 0 AND NOT a.attisdropped
    JOIN pg_type ref_t ON ref_t.oid = a.atttypid
    JOIN pg_namespace refns ON refns.oid = ref_t.typnamespace
    LEFT JOIN pg_class ref_comp ON ref_comp.oid = ref_t.typrelid
    WHERE comp.relkind = 'c'
      AND NOT refns.nspname LIKE ANY (ARRAY['pg\\_%','information\\_schema'])
      AND (
        ref_t.typtype IN ('d','e','r','m')
        OR (ref_t.typtype = 'c' AND ref_comp.relkind = 'c')
      )
      AND CASE ref_t.typtype
            WHEN 'c' THEN ref_comp.relname IS NOT NULL
            ELSE true
          END
  ),
  view_rewrite_rel_deps AS (
    SELECT DISTINCT
      COALESCE(
        dep_view.stable_id,
        CASE v.relkind
          WHEN 'v' THEN format('view:%I.%I', v_ns.nspname, v.relname)
          WHEN 'm' THEN format('materializedView:%I.%I', v_ns.nspname, v.relname)
          ELSE format('unknown:%s.%s', 'pg_class', v.oid::text)
        END
      ) AS dependent_stable_id,
      COALESCE(
        ref_obj.stable_id,
        CASE
          WHEN ref_attr.attnum IS NOT NULL THEN format('column:%I.%I.%I', ref_ns.nspname, ref_rel.relname, ref_attr.attname)
          WHEN ref_rel.relkind IN ('r','p','f') THEN format('table:%I.%I', ref_ns.nspname, ref_rel.relname)
          WHEN ref_rel.relkind = 'v' THEN format('view:%I.%I', ref_ns.nspname, ref_rel.relname)
          WHEN ref_rel.relkind = 'm' THEN format('materializedView:%I.%I', ref_ns.nspname, ref_rel.relname)
          ELSE format('unknown:%s.%s', 'pg_class', COALESCE(ref_rel.oid::text, d.refobjid::text))
        END
      ) AS referenced_stable_id,
      d.deptype,
      COALESCE(dep_view.schema_name, v_ns.nspname) AS dep_schema,
      COALESCE(ref_obj.schema_name, ref_ns.nspname) AS ref_schema
    FROM pg_depend d
    JOIN pg_rewrite r ON r.oid = d.objid
    JOIN pg_class v ON r.ev_class = v.oid
    JOIN pg_namespace v_ns ON v.relnamespace = v_ns.oid
    LEFT JOIN objects dep_view
      ON dep_view.classid = 'pg_class'::regclass
     AND dep_view.objid = v.oid
     AND dep_view.objsubid = 0
    LEFT JOIN pg_class ref_rel ON ref_rel.oid = d.refobjid
    LEFT JOIN pg_namespace ref_ns ON ref_rel.relnamespace = ref_ns.oid
    LEFT JOIN pg_attribute ref_attr
      ON ref_attr.attrelid = ref_rel.oid
     AND ref_attr.attnum = d.refobjsubid
     AND d.refobjsubid <> 0
    LEFT JOIN objects ref_obj
      ON ref_obj.classid = d.refclassid
     AND ref_obj.objid = d.refobjid
     AND ref_obj.objsubid = COALESCE(NULLIF(d.refobjsubid,0),0)
    WHERE d.classid = 'pg_rewrite'::regclass
      AND d.refclassid = 'pg_class'::regclass
      AND v.relkind IN ('v','m')
      AND d.deptype = 'n'
      AND (d.refobjsubid = 0 OR (ref_attr.attnum > 0 AND NOT ref_attr.attisdropped))
      AND ref_rel.oid IS NOT NULL
      AND (
        ref_attr.attnum IS NOT NULL
        OR ref_rel.relkind IN ('r','p','f','v','m')
      )
  ),
  view_rewrite_proc_deps AS (
    SELECT DISTINCT
      COALESCE(
        dep_view.stable_id,
        CASE v.relkind
          WHEN 'v' THEN format('view:%I.%I', v_ns.nspname, v.relname)
          WHEN 'm' THEN format('materializedView:%I.%I', v_ns.nspname, v.relname)
          ELSE format('unknown:%s.%s', 'pg_class', v.oid::text)
        END
      ) AS dependent_stable_id,
      COALESCE(
        ref_proc_obj.stable_id,
        CASE
          WHEN ref_proc.prokind = 'a' THEN format(
            'aggregate:%I.%I(%s)',
            ref_proc_ns.nspname,
            ref_proc.proname,
            trim(pg_catalog.pg_get_function_identity_arguments(ref_proc.oid))
          )
          ELSE format(
            'procedure:%I.%I(%s)',
            ref_proc_ns.nspname,
            ref_proc.proname,
            COALESCE(
              (
                SELECT string_agg(format_type(oid, NULL), ',' ORDER BY ord)
                FROM unnest(ref_proc.proargtypes) WITH ORDINALITY AS t(oid, ord)
              ),
              ''
            )
          )
        END
      ) AS referenced_stable_id,
      d.deptype,
      COALESCE(dep_view.schema_name, v_ns.nspname) AS dep_schema,
      COALESCE(ref_proc_obj.schema_name, ref_proc_ns.nspname) AS ref_schema
    FROM pg_depend d
    JOIN pg_rewrite r ON r.oid = d.objid
    JOIN pg_class v ON r.ev_class = v.oid
    JOIN pg_namespace v_ns ON v.relnamespace = v_ns.oid
    LEFT JOIN objects dep_view
      ON dep_view.classid = 'pg_class'::regclass
     AND dep_view.objid = v.oid
     AND dep_view.objsubid = 0
    JOIN pg_proc ref_proc ON ref_proc.oid = d.refobjid
    JOIN pg_namespace ref_proc_ns ON ref_proc_ns.oid = ref_proc.pronamespace
    LEFT JOIN objects ref_proc_obj
      ON ref_proc_obj.classid = 'pg_proc'::regclass
     AND ref_proc_obj.objid = ref_proc.oid
     AND ref_proc_obj.objsubid = 0
    WHERE d.classid = 'pg_rewrite'::regclass
      AND d.refclassid = 'pg_proc'::regclass
      AND v.relkind IN ('v','m')
      AND d.deptype = 'n'
  ),
  constraint_deps AS (
    SELECT DISTINCT
      format('constraint:%I.%I.%I', fk_ns.nspname, fk_table.relname, fk_con.conname) AS dependent_stable_id,
      format('constraint:%I.%I.%I', ref_ns.nspname, ref_table.relname, ref_con.conname) AS referenced_stable_id,
      'n'::"char" AS deptype,
      fk_ns.nspname AS dep_schema,
      ref_ns.nspname AS ref_schema
    FROM pg_constraint fk_con
    JOIN pg_class fk_table ON fk_con.conrelid = fk_table.oid
    JOIN pg_namespace fk_ns ON fk_table.relnamespace = fk_ns.oid
    JOIN pg_class ref_table ON fk_con.confrelid = ref_table.oid
    JOIN pg_namespace ref_ns ON ref_table.relnamespace = ref_ns.oid
    JOIN pg_constraint ref_con ON (
      ref_con.conrelid = fk_con.confrelid
      AND ref_con.contype IN ('p', 'u')
      AND ref_con.conkey = fk_con.confkey
    )
    WHERE fk_con.contype = 'f'
  ),
  index_schema_deps AS (
    -- Indexes depend on their schema (ensure schema exists before indexes)
    SELECT DISTINCT
      format('index:%I.%I.%I', ns.nspname, tbl.relname, idx_rel.relname) AS dependent_stable_id,
      format('schema:%I', ns.nspname) AS referenced_stable_id,
      'n'::"char" AS deptype,
      ns.nspname AS dep_schema,
      ns.nspname AS ref_schema
    FROM pg_class idx_rel
    JOIN pg_index idx ON idx.indexrelid = idx_rel.oid
    JOIN pg_class tbl ON tbl.oid = idx.indrelid
    JOIN pg_namespace ns ON ns.oid = idx_rel.relnamespace
    WHERE idx_rel.relkind = 'i'
  ),
  index_table_deps AS (
    -- Indexes depend on their owning table
    SELECT DISTINCT
      format('index:%I.%I.%I', ns.nspname, tbl.relname, idx_rel.relname) AS dependent_stable_id,
      format('table:%I.%I', ns.nspname, tbl.relname) AS referenced_stable_id,
      'n'::"char" AS deptype,
      ns.nspname AS dep_schema,
      ns.nspname AS ref_schema
    FROM pg_class idx_rel
    JOIN pg_index idx ON idx.indexrelid = idx_rel.oid
    JOIN pg_class tbl ON tbl.oid = idx.indrelid
    JOIN pg_namespace ns ON ns.oid = idx_rel.relnamespace
    WHERE idx_rel.relkind = 'i'
  ),
  ownership_deps AS (
    -- Schema ownership dependencies
    SELECT DISTINCT
      format('schema:%I', n.nspname) AS dependent_stable_id,
      format('role:%s', n.nspowner::regrole::text) AS referenced_stable_id,
      'n'::"char" AS deptype,
      n.nspname AS dep_schema,
      NULL::text AS ref_schema
    FROM pg_namespace n

    UNION ALL

    -- Table ownership dependencies
    SELECT DISTINCT
      format('table:%I.%I', n.nspname, c.relname) AS dependent_stable_id,
      format('role:%s', c.relowner::regrole::text) AS referenced_stable_id,
      'n'::"char" AS deptype,
      n.nspname AS dep_schema,
      NULL::text AS ref_schema
    FROM pg_class c
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE c.relkind IN ('r','p')

    UNION ALL

    -- View ownership dependencies
    SELECT DISTINCT
      format('view:%I.%I', n.nspname, c.relname) AS dependent_stable_id,
      format('role:%s', c.relowner::regrole::text) AS referenced_stable_id,
      'n'::"char" AS deptype,
      n.nspname AS dep_schema,
      NULL::text AS ref_schema
    FROM pg_class c
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE c.relkind = 'v'

    UNION ALL

    -- Materialized view ownership dependencies
    SELECT DISTINCT
      format('materializedView:%I.%I', n.nspname, c.relname) AS dependent_stable_id,
      format('role:%s', c.relowner::regrole::text) AS referenced_stable_id,
      'n'::"char" AS deptype,
      n.nspname AS dep_schema,
      NULL::text AS ref_schema
    FROM pg_class c
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE c.relkind = 'm'

    UNION ALL

    -- Sequence ownership dependencies
    SELECT DISTINCT
      format('sequence:%I.%I', n.nspname, c.relname) AS dependent_stable_id,
      format('role:%s', c.relowner::regrole::text) AS referenced_stable_id,
      'n'::"char" AS deptype,
      n.nspname AS dep_schema,
      NULL::text AS ref_schema
    FROM pg_class c
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE c.relkind = 'S'

    UNION ALL

    -- Composite type ownership dependencies
    SELECT DISTINCT
      format('compositeType:%I.%I', n.nspname, c.relname) AS dependent_stable_id,
      format('role:%s', c.relowner::regrole::text) AS referenced_stable_id,
      'n'::"char" AS deptype,
      n.nspname AS dep_schema,
      NULL::text AS ref_schema
    FROM pg_class c
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE c.relkind = 'c'

    UNION ALL

    -- Function/procedure/aggregate ownership dependencies
    SELECT DISTINCT
      CASE
        WHEN p.prokind = 'a' THEN format(
          'aggregate:%I.%I(%s)',
          n.nspname,
          p.proname,
          trim(pg_catalog.pg_get_function_identity_arguments(p.oid))
        )
        ELSE format(
          'procedure:%I.%I(%s)',
          n.nspname,
          p.proname,
          COALESCE(
            (
              SELECT string_agg(format_type(oid, NULL), ',' ORDER BY ord)
              FROM unnest(p.proargtypes) WITH ORDINALITY AS t(oid, ord)
            ),
            ''
          )
        )
      END AS dependent_stable_id,
      format('role:%s', p.proowner::regrole::text) AS referenced_stable_id,
      'n'::"char" AS deptype,
      n.nspname AS dep_schema,
      NULL::text AS ref_schema
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid

    UNION ALL

    -- Domain ownership dependencies
    SELECT DISTINCT
      format('domain:%I.%I', n.nspname, t.typname) AS dependent_stable_id,
      format('role:%s', t.typowner::regrole::text) AS referenced_stable_id,
      'n'::"char" AS deptype,
      n.nspname AS dep_schema,
      NULL::text AS ref_schema
    FROM pg_type t
    JOIN pg_namespace n ON t.typnamespace = n.oid
    WHERE t.typtype = 'd'

    UNION ALL

    -- Enum ownership dependencies
    SELECT DISTINCT
      format('enum:%I.%I', n.nspname, t.typname) AS dependent_stable_id,
      format('role:%s', t.typowner::regrole::text) AS referenced_stable_id,
      'n'::"char" AS deptype,
      n.nspname AS dep_schema,
      NULL::text AS ref_schema
    FROM pg_type t
    JOIN pg_namespace n ON t.typnamespace = n.oid
    WHERE t.typtype = 'e'

    UNION ALL

    -- Range type ownership dependencies
    SELECT DISTINCT
      format('range:%I.%I', n.nspname, t.typname) AS dependent_stable_id,
      format('role:%s', t.typowner::regrole::text) AS referenced_stable_id,
      'n'::"char" AS deptype,
      n.nspname AS dep_schema,
      NULL::text AS ref_schema
    FROM pg_type t
    JOIN pg_namespace n ON t.typnamespace = n.oid
    WHERE t.typtype = 'r'

    UNION ALL

    -- Multirange type ownership dependencies
    SELECT DISTINCT
      format('multirange:%I.%I', n.nspname, t.typname) AS dependent_stable_id,
      format('role:%s', t.typowner::regrole::text) AS referenced_stable_id,
      'n'::"char" AS deptype,
      n.nspname AS dep_schema,
      NULL::text AS ref_schema
    FROM pg_type t
    JOIN pg_namespace n ON t.typnamespace = n.oid
    WHERE t.typtype = 'm'

    UNION ALL

    -- Base type ownership dependencies
    SELECT DISTINCT
      format('type:%I.%I', n.nspname, t.typname) AS dependent_stable_id,
      format('role:%s', t.typowner::regrole::text) AS referenced_stable_id,
      'n'::"char" AS deptype,
      n.nspname AS dep_schema,
      NULL::text AS ref_schema
    FROM pg_type t
    JOIN pg_namespace n ON t.typnamespace = n.oid
    WHERE t.typtype = 'b'

    UNION ALL

    -- Trigger ownership dependencies (triggers inherit owner from their table)
    SELECT DISTINCT
      format('trigger:%I.%I.%I', tn.nspname, tc.relname, tg.tgname) AS dependent_stable_id,
      format('role:%s', tc.relowner::regrole::text) AS referenced_stable_id,
      'n'::"char" AS deptype,
      tn.nspname AS dep_schema,
      NULL::text AS ref_schema
    FROM pg_trigger tg
    JOIN pg_class tc ON tg.tgrelid = tc.oid
    JOIN pg_namespace tn ON tc.relnamespace = tn.oid
    WHERE NOT tg.tgisinternal

    UNION ALL

    -- RLS Policy ownership dependencies (policies inherit owner from their table)
    SELECT DISTINCT
      format('rlsPolicy:%I.%I.%I', tn.nspname, tc.relname, pol.polname) AS dependent_stable_id,
      format('role:%s', tc.relowner::regrole::text) AS referenced_stable_id,
      'n'::"char" AS deptype,
      tn.nspname AS dep_schema,
      NULL::text AS ref_schema
    FROM pg_policy pol
    JOIN pg_class tc ON pol.polrelid = tc.oid
    JOIN pg_namespace tn ON tc.relnamespace = tn.oid
    

    UNION ALL

    -- Language ownership dependencies
    SELECT DISTINCT
      format('language:%I', l.lanname) AS dependent_stable_id,
      format('role:%s', l.lanowner::regrole::text) AS referenced_stable_id,
      'n'::"char" AS deptype,
      NULL::text AS dep_schema,
      NULL::text AS ref_schema
    FROM pg_language l
    WHERE l.lanname NOT IN ('internal', 'c', 'sql')

    UNION ALL

    -- Event trigger ownership dependencies
    SELECT DISTINCT
      format('eventTrigger:%I', et.evtname) AS dependent_stable_id,
      format('role:%s', et.evtowner::regrole::text) AS referenced_stable_id,
      'n'::"char" AS deptype,
      NULL::text AS dep_schema,
      NULL::text AS ref_schema
    FROM pg_event_trigger et

    UNION ALL

    -- Extension ownership dependencies
    SELECT DISTINCT
      format('extension:%I', e.extname) AS dependent_stable_id,
      format('role:%s', e.extowner::regrole::text) AS referenced_stable_id,
      'n'::"char" AS deptype,
      NULL::text AS dep_schema,
      NULL::text AS ref_schema
    FROM pg_extension e
    WHERE e.extname <> 'plpgsql'

    UNION ALL

    -- Subscription ownership dependencies
    SELECT DISTINCT
      format('subscription:%I', s.subname) AS dependent_stable_id,
      format('role:%s', s.subowner::regrole::text) AS referenced_stable_id,
      'n'::"char" AS deptype,
      NULL::text AS dep_schema,
      NULL::text AS ref_schema
    FROM pg_subscription s
    WHERE s.subdbid = (SELECT oid FROM pg_database WHERE datname = current_database())

    UNION ALL
    
    -- Publication ownership dependencies
    SELECT DISTINCT
      format('publication:%I', p.pubname) AS dependent_stable_id,
      format('role:%s', p.pubowner::regrole::text) AS referenced_stable_id,
      'n'::"char" AS deptype,
      NULL::text AS dep_schema,
      NULL::text AS ref_schema
    FROM pg_publication p

    UNION ALL

    -- Collation ownership dependencies
    SELECT DISTINCT
      format('collation:%I.%I', n.nspname, c.collname) AS dependent_stable_id,
      format('role:%s', c.collowner::regrole::text) AS referenced_stable_id,
      'n'::"char" AS deptype,
      n.nspname AS dep_schema,
      NULL::text AS ref_schema
    FROM pg_collation c
    JOIN pg_namespace n ON c.collnamespace = n.oid
  ),
  publication_deps AS (
    SELECT DISTINCT
      format('publication:%I', pub.pubname) AS dependent_stable_id,
      format('table:%I.%I', ns.nspname, cls.relname) AS referenced_stable_id,
      'n'::"char" AS deptype,
      NULL::text AS dep_schema,
      ns.nspname AS ref_schema
    FROM pg_publication pub
    JOIN pg_publication_rel pr ON pr.prpubid = pub.oid
    JOIN pg_class cls ON cls.oid = pr.prrelid
    JOIN pg_namespace ns ON ns.oid = cls.relnamespace
    WHERE NOT ns.nspname LIKE ANY (ARRAY['pg\_%','information\_schema'])
  ),
  publication_schema_deps AS (
    SELECT DISTINCT
      format('publication:%I', pub.pubname) AS dependent_stable_id,
      format('schema:%I', ns.nspname) AS referenced_stable_id,
      'n'::"char" AS deptype,
      NULL::text AS dep_schema,
      ns.nspname AS ref_schema
    FROM pg_publication pub
    JOIN pg_publication_namespace pn ON pn.pnpubid = pub.oid
    JOIN pg_namespace ns ON ns.oid = pn.pnnspid
    WHERE NOT ns.nspname LIKE ANY (ARRAY['pg\_%','information\_schema'])
  ),
  all_rows AS (
    SELECT dependent_stable_id, referenced_stable_id, deptype, dep_schema, ref_schema FROM base
    UNION ALL
    SELECT dependent_stable_id, referenced_stable_id, deptype, dep_schema, ref_schema FROM comment_deps
    UNION ALL
    SELECT dependent_stable_id, referenced_stable_id, deptype, dep_schema, ref_schema FROM type_usage_deps
    UNION ALL
    SELECT dependent_stable_id, referenced_stable_id, deptype, dep_schema, ref_schema FROM view_rewrite_rel_deps
    UNION ALL
    SELECT dependent_stable_id, referenced_stable_id, deptype, dep_schema, ref_schema FROM view_rewrite_proc_deps
    UNION ALL
    SELECT dependent_stable_id, referenced_stable_id, deptype, dep_schema, ref_schema FROM constraint_deps
    UNION ALL
    SELECT dependent_stable_id, referenced_stable_id, deptype, dep_schema, ref_schema FROM index_schema_deps
    UNION ALL
    SELECT dependent_stable_id, referenced_stable_id, deptype, dep_schema, ref_schema FROM index_table_deps
    UNION ALL
    SELECT dependent_stable_id, referenced_stable_id, deptype, dep_schema, ref_schema FROM ownership_deps
    UNION ALL
    SELECT dependent_stable_id, referenced_stable_id, deptype, dep_schema, ref_schema FROM publication_deps
    UNION ALL
    SELECT dependent_stable_id, referenced_stable_id, deptype, dep_schema, ref_schema FROM publication_schema_deps
  )
  SELECT DISTINCT
    dependent_stable_id,
    referenced_stable_id,
    deptype
  FROM all_rows
  -- In some corner case (composite type) we can have the same stable ids in the case where an internal object depends on it's parent type
  -- eg: compositeType contains internal columns but we don't distinct them from the parent type itself in our stable ids
  WHERE dependent_stable_id <> referenced_stable_id
    -- filter rows where dependent object is part of Postgres internals
    AND NOT (
      COALESCE(dep_schema, '') LIKE ANY (ARRAY['pg\\_%','information\\_schema'])
    )
  ORDER BY dependent_stable_id, referenced_stable_id;
  `;

  // Extract privilege and membership dependencies
  const privilegeDepends = await extractPrivilegeAndMembershipDepends(sql);

  // Combine all dependency sources and remove duplicates
  const allDepends = new Set([...dependsRows, ...privilegeDepends]);

  return Array.from(allDepends).sort(
    (a, b) =>
      a.dependent_stable_id.localeCompare(b.dependent_stable_id) ||
      a.referenced_stable_id.localeCompare(b.referenced_stable_id),
  );
}
