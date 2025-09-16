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
 * Extract view dependencies from pg_rewrite via pg_depend.
 * Views depend on the objects they reference through their rewrite rules.
 * @param sql - The SQL client.
 * @returns Array of dependency objects for view dependencies.
 */
async function extractViewAndMaterializedViewsDepends(
  sql: Sql,
): Promise<PgDepend[]> {
  const dependsRows = await sql<PgDepend[]>`
    select * from (
      -- Views/materialized views depending on tables/views/materialized views
      select distinct
        case
          when v.relkind = 'v' then 'view:' || quote_ident(v_ns.nspname) || '.' || quote_ident(v.relname)
          when v.relkind = 'm' then 'materializedView:' || quote_ident(v_ns.nspname) || '.' || quote_ident(v.relname)
          else 'unknown:' || quote_ident(v.relname) || ':' || v.relkind::text
        end as dependent_stable_id,
        case
          when ref_obj.relkind = 'r' then 'table:' || quote_ident(ref_ns.nspname) || '.' || quote_ident(ref_obj.relname)
          when ref_obj.relkind = 'v' then 'view:' || quote_ident(ref_ns.nspname) || '.' || quote_ident(ref_obj.relname)
          when ref_obj.relkind = 'm' then 'materializedview:' || quote_ident(ref_ns.nspname) || '.' || quote_ident(ref_obj.relname)
          else 'unknown:' || quote_ident(ref_obj.relname)
        end as referenced_stable_id,
        d.deptype
      from pg_catalog.pg_depend d
      join pg_catalog.pg_class c1 on d.classid = c1.oid
      join pg_catalog.pg_class c2 on d.refclassid = c2.oid
      join pg_catalog.pg_rewrite r on r.oid = d.objid
      join pg_catalog.pg_class v on r.ev_class = v.oid
      join pg_catalog.pg_namespace v_ns on v.relnamespace = v_ns.oid
      join pg_catalog.pg_class ref_obj on d.refobjid = ref_obj.oid
      join pg_catalog.pg_namespace ref_ns on ref_obj.relnamespace = ref_ns.oid
      where quote_ident(c1.relname) = 'pg_rewrite'
        and quote_ident(c2.relname) = 'pg_class'
        and d.deptype = 'n'
        and c1.relnamespace = (select oid from pg_namespace where quote_ident(nspname) = 'pg_catalog')
        and c2.relnamespace = (select oid from pg_namespace where quote_ident(nspname) = 'pg_catalog')
      union all
      -- Views/materialized views depending on functions
      select distinct
        case
          when v.relkind = 'v' then 'view:' || quote_ident(v_ns.nspname) || '.' || quote_ident(v.relname)
          when v.relkind = 'm' then 'materializedView:' || quote_ident(v_ns.nspname) || '.' || quote_ident(v.relname)
          else 'unknown:' || quote_ident(v.relname) || ':' || v.relkind::text
        end as dependent_stable_id,
        'procedure:' || quote_ident(ref_proc_ns.nspname) || '.' || quote_ident(ref_proc.proname) || '('
          || coalesce(
            (
              select string_agg(format_type(oid, null), ',' order by ord)
              from unnest(ref_proc.proargtypes) with ordinality as t(oid, ord)
            ),
            ''
          ) || ')' as referenced_stable_id,
        d.deptype
      from pg_catalog.pg_depend d
      join pg_catalog.pg_class c1 on d.classid = c1.oid
      join pg_catalog.pg_class c2 on d.refclassid = c2.oid
      join pg_catalog.pg_rewrite r on r.oid = d.objid
      join pg_catalog.pg_class v on r.ev_class = v.oid
      join pg_catalog.pg_namespace v_ns on v.relnamespace = v_ns.oid
      join pg_catalog.pg_proc ref_proc on d.refobjid = ref_proc.oid
      join pg_catalog.pg_namespace ref_proc_ns on ref_proc.pronamespace = ref_proc_ns.oid
      where quote_ident(c1.relname) = 'pg_rewrite'
        and quote_ident(c2.relname) = 'pg_proc'
        and d.deptype = 'n'
        and c1.relnamespace = (select oid from pg_namespace where quote_ident(nspname) = 'pg_catalog')
        and c2.relnamespace = (select oid from pg_namespace where quote_ident(nspname) = 'pg_catalog')
    ) as view_depends_rows
    where dependent_stable_id != referenced_stable_id
  `;

  return dependsRows;
}

/**
 * Extract ownership dependencies between all database objects and their owner roles.
 * These dependencies ensure that roles are created before objects that depend on them,
 * and objects are dropped before their owner roles.
 */
async function extractOwnershipDepends(sql: Sql): Promise<PgDepend[]> {
  const ownershipRows = await sql<PgDepend[]>`
-- OWNERSHIP DEPENDENCIES: All objects depend on their owner roles

-- Schema ownership dependencies
SELECT DISTINCT
  'schema:' || quote_ident(n.nspname) as dependent_stable_id,
  'role:' || n.nspowner::regrole::text as referenced_stable_id,
  'n'::char as deptype
FROM pg_namespace n
WHERE NOT n.nspname LIKE ANY(ARRAY['pg\\_%', 'information\\_schema'])

UNION ALL

-- Table ownership dependencies  
SELECT DISTINCT
  'table:' || quote_ident(n.nspname) || '.' || quote_ident(c.relname) as dependent_stable_id,
  'role:' || c.relowner::regrole::text as referenced_stable_id,
  'n'::char as deptype
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE c.relkind IN ('r', 'p')
  AND NOT n.nspname LIKE ANY(ARRAY['pg\\_%', 'information\\_schema'])

UNION ALL

-- View ownership dependencies
SELECT DISTINCT
  'view:' || quote_ident(n.nspname) || '.' || quote_ident(c.relname) as dependent_stable_id,
  'role:' || c.relowner::regrole::text as referenced_stable_id,
  'n'::char as deptype
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE c.relkind = 'v'
  AND NOT n.nspname LIKE ANY(ARRAY['pg\\_%', 'information\\_schema'])

UNION ALL

-- Materialized view ownership dependencies
SELECT DISTINCT
  'materializedView:' || quote_ident(n.nspname) || '.' || quote_ident(c.relname) as dependent_stable_id,
  'role:' || c.relowner::regrole::text as referenced_stable_id,
  'n'::char as deptype
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE c.relkind = 'm'
  AND NOT n.nspname LIKE ANY(ARRAY['pg\\_%', 'information\\_schema'])

UNION ALL

-- Sequence ownership dependencies
SELECT DISTINCT
  'sequence:' || quote_ident(n.nspname) || '.' || quote_ident(c.relname) as dependent_stable_id,
  'role:' || c.relowner::regrole::text as referenced_stable_id,
  'n'::char as deptype
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE c.relkind = 'S'
  AND NOT n.nspname LIKE ANY(ARRAY['pg\\_%', 'information\\_schema'])

UNION ALL

-- Composite type ownership dependencies
SELECT DISTINCT
  'compositeType:' || quote_ident(n.nspname) || '.' || quote_ident(c.relname) as dependent_stable_id,
  'role:' || c.relowner::regrole::text as referenced_stable_id,
  'n'::char as deptype
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE c.relkind = 'c'
  AND NOT n.nspname LIKE ANY(ARRAY['pg\\_%', 'information\\_schema'])

UNION ALL

-- Function/procedure ownership dependencies
SELECT DISTINCT
  'procedure:' || quote_ident(n.nspname) || '.' || quote_ident(p.proname) || '('
    || COALESCE(
      (
        SELECT string_agg(format_type(oid, null), ',' ORDER BY ord)
        FROM unnest(p.proargtypes) WITH ORDINALITY AS t(oid, ord)
      ),
      ''
    )
    || ')' as dependent_stable_id,
  'role:' || p.proowner::regrole::text as referenced_stable_id,
  'n'::char as deptype
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE NOT n.nspname LIKE ANY(ARRAY['pg\\_%', 'information\\_schema'])

UNION ALL

-- Domain ownership dependencies
SELECT DISTINCT
  'domain:' || quote_ident(n.nspname) || '.' || quote_ident(t.typname) as dependent_stable_id,
  'role:' || t.typowner::regrole::text as referenced_stable_id,
  'n'::char as deptype
FROM pg_type t
JOIN pg_namespace n ON t.typnamespace = n.oid
WHERE t.typtype = 'd'
  AND NOT n.nspname LIKE ANY(ARRAY['pg\\_%', 'information\\_schema'])

UNION ALL

-- Enum ownership dependencies
SELECT DISTINCT
  'enum:' || quote_ident(n.nspname) || '.' || quote_ident(t.typname) as dependent_stable_id,
  'role:' || t.typowner::regrole::text as referenced_stable_id,
  'n'::char as deptype
FROM pg_type t
JOIN pg_namespace n ON t.typnamespace = n.oid
WHERE t.typtype = 'e'
  AND NOT n.nspname LIKE ANY(ARRAY['pg\\_%', 'information\\_schema'])

UNION ALL

-- Range type ownership dependencies
SELECT DISTINCT
  'range:' || quote_ident(n.nspname) || '.' || quote_ident(t.typname) as dependent_stable_id,
  'role:' || t.typowner::regrole::text as referenced_stable_id,
  'n'::char as deptype
FROM pg_type t
JOIN pg_namespace n ON t.typnamespace = n.oid
WHERE t.typtype = 'r'
  AND NOT n.nspname LIKE ANY(ARRAY['pg\\_%', 'information\\_schema'])

UNION ALL

-- Multirange type ownership dependencies
SELECT DISTINCT
  'multirange:' || quote_ident(n.nspname) || '.' || quote_ident(t.typname) as dependent_stable_id,
  'role:' || t.typowner::regrole::text as referenced_stable_id,
  'n'::char as deptype
FROM pg_type t
JOIN pg_namespace n ON t.typnamespace = n.oid
WHERE t.typtype = 'm'
  AND NOT n.nspname LIKE ANY(ARRAY['pg\\_%', 'information\\_schema'])

UNION ALL

-- Base type ownership dependencies
SELECT DISTINCT
  'type:' || quote_ident(n.nspname) || '.' || quote_ident(t.typname) as dependent_stable_id,
  'role:' || t.typowner::regrole::text as referenced_stable_id,
  'n'::char as deptype
FROM pg_type t
JOIN pg_namespace n ON t.typnamespace = n.oid
WHERE t.typtype = 'b'
  AND NOT n.nspname LIKE ANY(ARRAY['pg\\_%', 'information\\_schema'])

UNION ALL

-- Trigger ownership dependencies (triggers inherit owner from their table)
SELECT DISTINCT
  'trigger:' || quote_ident(tn.nspname) || '.' || quote_ident(tc.relname) || '.' || quote_ident(tg.tgname) as dependent_stable_id,
  'role:' || tc.relowner::regrole::text as referenced_stable_id,
  'n'::char as deptype
FROM pg_trigger tg
JOIN pg_class tc ON tg.tgrelid = tc.oid
JOIN pg_namespace tn ON tc.relnamespace = tn.oid
WHERE NOT tn.nspname LIKE ANY(ARRAY['pg\\_%', 'information\\_schema'])
  AND NOT tg.tgisinternal

UNION ALL

-- RLS Policy ownership dependencies (policies inherit owner from their table)
SELECT DISTINCT
  'rlsPolicy:' || quote_ident(tn.nspname) || '.' || quote_ident(tc.relname) || '.' || quote_ident(pol.polname) as dependent_stable_id,
  'role:' || tc.relowner::regrole::text as referenced_stable_id,
  'n'::char as deptype
FROM pg_policy pol
JOIN pg_class tc ON pol.polrelid = tc.oid
JOIN pg_namespace tn ON tc.relnamespace = tn.oid
WHERE NOT tn.nspname LIKE ANY(ARRAY['pg\\_%', 'information\\_schema'])

UNION ALL

-- Language ownership dependencies
SELECT DISTINCT
  'language:' || quote_ident(l.lanname) as dependent_stable_id,
  'role:' || l.lanowner::regrole::text as referenced_stable_id,
  'n'::char as deptype
FROM pg_language l
WHERE l.lanname NOT IN ('internal', 'c', 'sql')

UNION ALL

-- Extension ownership dependencies
SELECT DISTINCT
  'extension:' || quote_ident(e.extname) as dependent_stable_id,
  'role:' || e.extowner::regrole::text as referenced_stable_id,
  'n'::char as deptype
FROM pg_extension e
WHERE e.extname <> 'plpgsql'  -- Exclude default extensions

UNION ALL

-- Collation ownership dependencies
SELECT DISTINCT
  'collation:' || quote_ident(n.nspname) || '.' || quote_ident(c.collname) as dependent_stable_id,
  'role:' || c.collowner::regrole::text as referenced_stable_id,
  'n'::char as deptype
FROM pg_collation c
JOIN pg_namespace n ON c.collnamespace = n.oid
WHERE NOT n.nspname LIKE ANY(ARRAY['pg\\_%', 'information\\_schema'])
  `;

  return ownershipRows;
}

/**
 * Extract constraint-to-constraint dependencies between foreign key constraints
 * and their referenced unique/primary key constraints.
 */
async function extractConstraintDepends(sql: Sql): Promise<PgDepend[]> {
  const constraintRows = await sql<PgDepend[]>`
-- CONSTRAINT-TO-CONSTRAINT DEPENDENCIES: Foreign key constraints depend on their referenced unique/primary key constraints

-- Foreign key constraint dependencies on referenced unique/primary key constraints
SELECT DISTINCT
  'constraint:' || quote_ident(fk_ns.nspname) || '.' || quote_ident(fk_table.relname) || '.' || quote_ident(fk_con.conname) as dependent_stable_id,
  'constraint:' || quote_ident(ref_ns.nspname) || '.' || quote_ident(ref_table.relname) || '.' || quote_ident(ref_con.conname) as referenced_stable_id,
  'n'::char as deptype
FROM pg_constraint fk_con
-- Foreign key constraint table and schema
JOIN pg_class fk_table ON fk_con.conrelid = fk_table.oid
JOIN pg_namespace fk_ns ON fk_table.relnamespace = fk_ns.oid
-- Referenced table and schema
JOIN pg_class ref_table ON fk_con.confrelid = ref_table.oid
JOIN pg_namespace ref_ns ON ref_table.relnamespace = ref_ns.oid
-- Find the referenced unique/primary key constraint
JOIN pg_constraint ref_con ON (
  ref_con.conrelid = fk_con.confrelid  -- Same referenced table
  AND ref_con.contype IN ('p', 'u')    -- Primary key or unique constraint
  AND ref_con.conkey = fk_con.confkey   -- Same columns
)
WHERE fk_con.contype = 'f'  -- Only foreign key constraints
  AND NOT fk_ns.nspname LIKE ANY(ARRAY['pg\\_%', 'information\\_schema'])
  AND NOT ref_ns.nspname LIKE ANY(ARRAY['pg\\_%', 'information\\_schema'])
  `;

  return constraintRows;
}

/**
 * Extract dependencies where tables depend on functions, either via
 * column defaults (pg_attrdef) or table constraints (pg_constraint).
 */
async function extractTableAndConstraintFunctionDepends(
  sql: Sql,
): Promise<PgDepend[]> {
  const rows = await sql<PgDepend[]>`
    -- Table depends on function via column default expression
    select distinct
      'table:' || quote_ident(ns.nspname) || '.' || quote_ident(tbl.relname) as dependent_stable_id,
      'procedure:' || quote_ident(proc_ns.nspname) || '.' || quote_ident(proc.proname) || '('
        || coalesce(
          (
            select string_agg(format_type(oid, null), ',' order by ord)
            from unnest(proc.proargtypes) with ordinality as t(oid, ord)
          ),
          ''
        ) || ')' as referenced_stable_id,
      d.deptype
    from pg_depend d
    join pg_class c_dep on d.classid = c_dep.oid and quote_ident(c_dep.relname) = 'pg_attrdef'
    join pg_attrdef ad on d.objid = ad.oid
    join pg_class tbl on ad.adrelid = tbl.oid
    join pg_namespace ns on tbl.relnamespace = ns.oid
    join pg_class c_ref on d.refclassid = c_ref.oid and quote_ident(c_ref.relname) = 'pg_proc'
    join pg_proc proc on d.refobjid = proc.oid
    join pg_namespace proc_ns on proc.pronamespace = proc_ns.oid
    where d.deptype = 'n'
    union all
    -- Table depends on function via CHECK constraint expression
    select distinct
      'table:' || quote_ident(ns.nspname) || '.' || quote_ident(tbl.relname) as dependent_stable_id,
      'procedure:' || quote_ident(proc_ns.nspname) || '.' || quote_ident(proc.proname) || '('
        || coalesce(
          (
            select string_agg(format_type(oid, null), ',' order by ord)
            from unnest(proc.proargtypes) with ordinality as t(oid, ord)
          ),
          ''
        ) || ')' as referenced_stable_id,
      d.deptype
    from pg_depend d
    join pg_class c_dep on d.classid = c_dep.oid and quote_ident(c_dep.relname) = 'pg_constraint'
    join pg_constraint con on d.objid = con.oid and con.conrelid <> 0
    join pg_class tbl on con.conrelid = tbl.oid
    join pg_namespace ns on tbl.relnamespace = ns.oid
    join pg_class c_ref on d.refclassid = c_ref.oid and quote_ident(c_ref.relname) = 'pg_proc'
    join pg_proc proc on d.refobjid = proc.oid
    join pg_namespace proc_ns on proc.pronamespace = proc_ns.oid
    where d.deptype = 'n'
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
select * from (
  select distinct
  -- Dependent stable ID
  case
    -- Schema (namespace)
    when quote_ident(dep_class.relname) = 'pg_namespace' and dep_namespace.oid is not null
      then 'schema:' || quote_ident(dep_namespace.nspname)
    -- Table
    when quote_ident(dep_class.relname) = 'pg_class' and dep_obj.oid is not null and dep_obj.relkind in ('r','p')
      then 'table:' || quote_ident(dep_ns.nspname) || '.' || quote_ident(dep_obj.relname)
    
    -- View
    when quote_ident(dep_class.relname) = 'pg_class' and dep_obj.oid is not null and dep_obj.relkind = 'v'
      then 'view:' || quote_ident(dep_ns.nspname) || '.' || quote_ident(dep_obj.relname)
    
    -- Materialized View
    when quote_ident(dep_class.relname) = 'pg_class' and dep_obj.oid is not null and dep_obj.relkind = 'm'
      then 'materializedView:' || quote_ident(dep_ns.nspname) || '.' || quote_ident(dep_obj.relname)
    
    -- Sequence
    when quote_ident(dep_class.relname) = 'pg_class' and dep_obj.oid is not null and dep_obj.relkind = 'S'
      then 'sequence:' || quote_ident(dep_ns.nspname) || '.' || quote_ident(dep_obj.relname)
    
    -- Index
    when quote_ident(dep_class.relname) = 'pg_class' and dep_obj.oid is not null and dep_obj.relkind = 'i'
      then 'index:' || quote_ident(dep_ns.nspname) || '.' || quote_ident(dep_obj.relname)
    
    -- System catalog tables (information_schema, pg_catalog, etc.)
    when quote_ident(dep_class.relname) = 'pg_class' and dep_obj.oid is not null and dep_obj.relkind = 'r' and quote_ident(dep_ns.nspname) in ('information_schema', 'pg_catalog', 'pg_toast')
      then 'systemTable:' || quote_ident(dep_ns.nspname) || '.' || quote_ident(dep_obj.relname)
    
    -- System catalog views (information_schema, pg_catalog, etc.)
    when quote_ident(dep_class.relname) = 'pg_class' and dep_obj.oid is not null and dep_obj.relkind = 'v' and quote_ident(dep_ns.nspname) in ('information_schema', 'pg_catalog', 'pg_toast')
      then 'systemView:' || quote_ident(dep_ns.nspname) || '.' || quote_ident(dep_obj.relname)
    
    -- System catalog sequences (information_schema, pg_catalog, etc.)
    when quote_ident(dep_class.relname) = 'pg_class' and dep_obj.oid is not null and dep_obj.relkind = 'S' and quote_ident(dep_ns.nspname) in ('information_schema', 'pg_catalog', 'pg_toast')
      then 'systemSequence:' || quote_ident(dep_ns.nspname) || '.' || quote_ident(dep_obj.relname)
    
    -- System catalog indexes (information_schema, pg_catalog, etc.)
    when quote_ident(dep_class.relname) = 'pg_class' and dep_obj.oid is not null and dep_obj.relkind = 'i' and quote_ident(dep_ns.nspname) in ('information_schema', 'pg_catalog', 'pg_toast')
      then 'systemIndex:' || quote_ident(dep_ns.nspname) || '.' || quote_ident(dep_obj.relname)
    
    -- Handle any remaining pg_class objects with unknown relkind values
    when quote_ident(dep_class.relname) = 'pg_class' and dep_obj.oid is not null and quote_ident(dep_ns.nspname) in ('information_schema', 'pg_catalog', 'pg_toast')
      then 'systemObject:' || quote_ident(dep_ns.nspname) || '.' || quote_ident(dep_obj.relname) || ':' || dep_obj.relkind::text
    
    -- Types
    -- Domain
    when quote_ident(dep_class.relname) = 'pg_type' and dep_type.oid is not null and dep_type.typtype = 'd'
      then 'domain:' || quote_ident(dep_type_ns.nspname) || '.' || quote_ident(dep_type.typname)
    -- Enum
    when quote_ident(dep_class.relname) = 'pg_type' and dep_type.oid is not null and dep_type.typtype = 'e'
      then 'enum:' || quote_ident(dep_type_ns.nspname) || '.' || quote_ident(dep_type.typname)
    -- Range type
    when quote_ident(dep_class.relname) = 'pg_type' and dep_type.oid is not null and dep_type.typtype = 'r'
      then 'range:' || quote_ident(dep_type_ns.nspname) || '.' || quote_ident(dep_type.typname)
    -- Multirange type
    when quote_ident(dep_class.relname) = 'pg_type' and dep_type.oid is not null and dep_type.typtype = 'm'
      then 'multirange:' || quote_ident(dep_type_ns.nspname) || '.' || quote_ident(dep_type.typname)
    -- Composite type
    when quote_ident(dep_class.relname) = 'pg_type' and dep_type.oid is not null and dep_type.typtype = 'c'
      then 'compositeType:' || quote_ident(dep_type_ns.nspname) || '.' || quote_ident(dep_type.typname)
    -- When a composite type is created sub-elements references are stored in pg_class (columsn of the composite type)
    when quote_ident(dep_class.relname) = 'pg_class' and dep_obj.oid is not null and dep_obj.relkind = 'c'
      then 'compositeType:' || quote_ident(dep_ns.nspname) || '.' || quote_ident(dep_obj.relname)
    -- Base type
    when quote_ident(dep_class.relname) = 'pg_type' and dep_type.oid is not null and dep_type.typtype = 'b'
      then 'type:' || quote_ident(dep_type_ns.nspname) || '.' || quote_ident(dep_type.typname)
    -- Pseudo-type
    when quote_ident(dep_class.relname) = 'pg_type' and dep_type.oid is not null and dep_type.typtype = 'p'
      then 'pseudoType:' || quote_ident(dep_type_ns.nspname) || '.' || quote_ident(dep_type.typname)

    -- Constraint on domain
    when quote_ident(dep_class.relname) = 'pg_constraint' and dep_con.oid is not null and dep_con.contypid != 0 and dep_con_type.oid is not null
      then 'constraint:' || quote_ident(dep_con_type_ns.nspname) || '.' || quote_ident(dep_con_type.typname) || '.' || quote_ident(dep_con.conname)
    -- Constraint on table
    when quote_ident(dep_class.relname) = 'pg_constraint' and dep_con.oid is not null and dep_con.conrelid != 0 and dep_con_table.oid is not null
      then 'constraint:' || quote_ident(dep_con_table_ns.nspname) || '.' || quote_ident(dep_con_table.relname) || '.' || quote_ident(dep_con.conname)
    
    -- Policy
    when quote_ident(dep_class.relname) = 'pg_policy' and dep_policy.oid is not null and dep_policy_table.oid is not null
      then 'rlsPolicy:' || quote_ident(dep_policy_table_ns.nspname) || '.' || quote_ident(dep_policy_table.relname) || '.' || quote_ident(dep_policy.polname)
    
    -- Function/Procedure (include identity argument types for overload distinction)
    when quote_ident(dep_class.relname) = 'pg_proc' and dep_proc.oid is not null
      then 'procedure:' || quote_ident(dep_proc_ns.nspname) || '.' || quote_ident(dep_proc.proname) || '('
        || coalesce(
          (
            select string_agg(format_type(oid, null), ',' order by ord)
            from unnest(dep_proc.proargtypes) with ordinality as t(oid, ord)
          ),
          ''
        )
        || ')'
    
    -- Trigger
    when quote_ident(dep_class.relname) = 'pg_trigger' and dep_trigger.oid is not null and dep_trigger_table.oid is not null
      then 'trigger:' || quote_ident(dep_trigger_table_ns.nspname) || '.' || quote_ident(dep_trigger_table.relname) || '.' || quote_ident(dep_trigger.tgname)
    
    -- Language
    when quote_ident(dep_class.relname) = 'pg_language' and dep_language.oid is not null
      then 'language:' || quote_ident(dep_language.lanname)
    
    -- Rewrite rule
    when quote_ident(dep_class.relname) = 'pg_rewrite' and dep_rewrite.oid is not null and dep_rewrite_table.oid is not null
      then 'rewriteRule:' || quote_ident(dep_rewrite_table_ns.nspname) || '.' || quote_ident(dep_rewrite_table.relname) || '.' || quote_ident(dep_rewrite.rulename)
    
    -- Text search configuration
    when quote_ident(dep_class.relname) = 'pg_ts_config' and dep_ts_config.oid is not null
      then 'tsConfig:' || quote_ident(dep_ts_config_ns.nspname) || '.' || quote_ident(dep_ts_config.cfgname)
    
    -- Text search dictionary
    when quote_ident(dep_class.relname) = 'pg_ts_dict' and dep_ts_dict.oid is not null
      then 'tsDict:' || quote_ident(dep_ts_dict_ns.nspname) || '.' || quote_ident(dep_ts_dict.dictname)
    
    -- Text search template
    when quote_ident(dep_class.relname) = 'pg_ts_template' and dep_ts_template.oid is not null
      then 'tsTemplate:' || quote_ident(dep_ts_template_ns.nspname) || '.' || quote_ident(dep_ts_template.tmplname)
    
    -- Attribute defaults (column default values)
    when quote_ident(dep_class.relname) = 'pg_attrdef' and dep_attrdef.oid is not null and dep_attrdef_table.oid is not null
      then 'attrdef:' || quote_ident(dep_attrdef_table_ns.nspname) || '.' || quote_ident(dep_attrdef_table.relname) || '.' || dep_attrdef.adnum::text
    
    -- Default ACLs
    when quote_ident(dep_class.relname) = 'pg_default_acl' and dep_default_acl.oid is not null and dep_default_acl_ns.oid is not null
      then 'defaultAcl:' || quote_ident(dep_default_acl_ns.nspname) || '.' || dep_default_acl.defaclobjtype::text
    
    -- Event triggers
    when quote_ident(dep_class.relname) = 'pg_event_trigger' and dep_event_trigger.oid is not null
      then 'eventTrigger:' || quote_ident(dep_event_trigger.evtname)
    
    -- Extensions
    when quote_ident(dep_class.relname) = 'pg_extension' and dep_extension.oid is not null
      then 'extension:' || quote_ident(dep_extension.extname)
    
    else 'unknown:' || quote_ident(dep_class.relname) || '.' || d.objid::text
  end as dependent_stable_id,

  -- Referenced stable ID
  case
    -- Schema (namespace)
    when quote_ident(ref_class.relname) = 'pg_namespace' and ref_namespace.oid is not null
      then 'schema:' || quote_ident(ref_namespace.nspname)
    -- Table
    when quote_ident(ref_class.relname) = 'pg_class' and ref_obj.oid is not null and ref_obj.relkind in ('r','p')
      then 'table:' || quote_ident(ref_ns.nspname) || '.' || quote_ident(ref_obj.relname)
    -- View
    when quote_ident(ref_class.relname) = 'pg_class' and ref_obj.oid is not null and ref_obj.relkind = 'v'
      then 'view:' || quote_ident(ref_ns.nspname) || '.' || quote_ident(ref_obj.relname)
    -- Materialized View
    when quote_ident(ref_class.relname) = 'pg_class' and ref_obj.oid is not null and ref_obj.relkind = 'm'
      then 'materializedView:' || quote_ident(ref_ns.nspname) || '.' || quote_ident(ref_obj.relname)
    -- Sequence
    when quote_ident(ref_class.relname) = 'pg_class' and ref_obj.oid is not null and ref_obj.relkind = 'S'
      then 'sequence:' || quote_ident(ref_ns.nspname) || '.' || quote_ident(ref_obj.relname)
    -- Index
    when quote_ident(ref_class.relname) = 'pg_class' and ref_obj.oid is not null and ref_obj.relkind = 'i'
      then 'index:' || quote_ident(ref_ns.nspname) || '.' || quote_ident(ref_obj.relname)
    -- System catalog tables (information_schema, pg_catalog, etc.)
    when quote_ident(ref_class.relname) = 'pg_class' and ref_obj.oid is not null and ref_obj.relkind = 'r' and quote_ident(ref_ns.nspname) in ('information_schema', 'pg_catalog', 'pg_toast')
      then 'systemTable:' || quote_ident(ref_ns.nspname) || '.' || quote_ident(ref_obj.relname)
    -- System catalog views (information_schema, pg_catalog, etc.)
    when quote_ident(ref_class.relname) = 'pg_class' and ref_obj.oid is not null and ref_obj.relkind = 'v' and quote_ident(ref_ns.nspname) in ('information_schema', 'pg_catalog', 'pg_toast')
      then 'systemView:' || quote_ident(ref_ns.nspname) || '.' || quote_ident(ref_obj.relname)
    -- System catalog sequences (information_schema, pg_catalog, etc.)
    when quote_ident(ref_class.relname) = 'pg_class' and ref_obj.oid is not null and ref_obj.relkind = 'S' and quote_ident(ref_ns.nspname) in ('information_schema', 'pg_catalog', 'pg_toast')
      then 'systemSequence:' || quote_ident(ref_ns.nspname) || '.' || quote_ident(ref_obj.relname)
    -- System catalog indexes (information_schema, pg_catalog, etc.)
    when quote_ident(ref_class.relname) = 'pg_class' and ref_obj.oid is not null and ref_obj.relkind = 'i' and quote_ident(ref_ns.nspname) in ('information_schema', 'pg_catalog', 'pg_toast')
      then 'systemIndex:' || quote_ident(ref_ns.nspname) || '.' || quote_ident(ref_obj.relname)
    -- Handle any remaining pg_class objects with unknown relkind values
    when quote_ident(ref_class.relname) = 'pg_class' and ref_obj.oid is not null and quote_ident(ref_ns.nspname) in ('information_schema', 'pg_catalog', 'pg_toast')
      then 'systemObject:' || quote_ident(ref_ns.nspname) || '.' || quote_ident(ref_obj.relname) || ':' || ref_obj.relkind::text
    -- Composite Type
    when quote_ident(ref_class.relname) = 'pg_type' and ref_type.oid is not null and ref_type.typtype = 'd'
      then 'domain:' || quote_ident(ref_type_ns.nspname) || '.' || quote_ident(ref_type.typname)
    when quote_ident(ref_class.relname) = 'pg_type' and ref_type.oid is not null and ref_type.typtype = 'e'
      then 'enum:' || quote_ident(ref_type_ns.nspname) || '.' || quote_ident(ref_type.typname)
    when quote_ident(ref_class.relname) = 'pg_type' and ref_type.oid is not null and ref_type.typtype = 'r'
      then 'range:' || quote_ident(ref_type_ns.nspname) || '.' || quote_ident(ref_type.typname)
    when quote_ident(ref_class.relname) = 'pg_type' and ref_type.oid is not null and ref_type.typtype = 'm'
      then 'multirange:' || quote_ident(ref_type_ns.nspname) || '.' || quote_ident(ref_type.typname)
    when quote_ident(ref_class.relname) = 'pg_type' and ref_type.oid is not null and ref_type.typtype = 'c'
      then 'compositeType:' || quote_ident(ref_type_ns.nspname) || '.' || quote_ident(ref_type.typname)
    -- When a composite type is created sub-elements references are stored in pg_class (columsn of the composite type)
    when quote_ident(ref_class.relname) = 'pg_class' and ref_obj.oid is not null and ref_obj.relkind = 'c'
      then 'compositeType:' || quote_ident(ref_ns.nspname) || '.' || quote_ident(ref_obj.relname)
    when quote_ident(ref_class.relname) = 'pg_type' and ref_type.oid is not null and ref_type.typtype = 'b'
      then 'type:' || quote_ident(ref_type_ns.nspname) || '.' || quote_ident(ref_type.typname)
    when quote_ident(ref_class.relname) = 'pg_type' and ref_type.oid is not null
      then 'type:' || quote_ident(ref_type_ns.nspname) || '.' || quote_ident(ref_type.typname)
    -- Constraint on domain
    when quote_ident(ref_class.relname) = 'pg_constraint' and ref_con.oid is not null and ref_con.contypid != 0 and ref_con_type.oid is not null
      then 'constraint:' || quote_ident(ref_con_type_ns.nspname) || '.' || quote_ident(ref_con_type.typname) || '.' || quote_ident(ref_con.conname)
    -- Constraint on table
    when quote_ident(ref_class.relname) = 'pg_constraint' and ref_con.oid is not null and ref_con.conrelid != 0 and ref_con_table.oid is not null
      then 'constraint:' || quote_ident(ref_con_table_ns.nspname) || '.' || quote_ident(ref_con_table.relname) || '.' || quote_ident(ref_con.conname)
    -- Policy
    when quote_ident(ref_class.relname) = 'pg_policy' and ref_policy.oid is not null and ref_policy_table.oid is not null
      then 'rlsPolicy:' || quote_ident(ref_policy_table_ns.nspname) || '.' || quote_ident(ref_policy_table.relname) || '.' || quote_ident(ref_policy.polname)
    -- Function/Procedure
    when quote_ident(ref_class.relname) = 'pg_proc' and ref_proc.oid is not null
      then 'procedure:' || quote_ident(ref_proc_ns.nspname) || '.' || quote_ident(ref_proc.proname) || '('
        || coalesce(
          (
            select string_agg(format_type(oid, null), ',' order by ord)
            from unnest(ref_proc.proargtypes) with ordinality as t(oid, ord)
          ),
          ''
        )
        || ')'
    -- Trigger
    when quote_ident(ref_class.relname) = 'pg_trigger' and ref_trigger.oid is not null and ref_trigger_table.oid is not null
      then 'trigger:' || quote_ident(ref_trigger_table_ns.nspname) || '.' || quote_ident(ref_trigger_table.relname) || '.' || quote_ident(ref_trigger.tgname)
    
    -- Language
    when quote_ident(ref_class.relname) = 'pg_language' and ref_language.oid is not null
      then 'language:' || quote_ident(ref_language.lanname)
    
    -- Rewrite rule
    when quote_ident(ref_class.relname) = 'pg_rewrite' and ref_rewrite.oid is not null and ref_rewrite_table.oid is not null
      then 'rewriteRule:' || quote_ident(ref_rewrite_table_ns.nspname) || '.' || quote_ident(ref_rewrite_table.relname) || '.' || quote_ident(ref_rewrite.rulename)
    
    -- Text search configuration
    when quote_ident(ref_class.relname) = 'pg_ts_config' and ref_ts_config.oid is not null
      then 'tsConfig:' || quote_ident(ref_ts_config_ns.nspname) || '.' || quote_ident(ref_ts_config.cfgname)
    
    -- Text search dictionary
    when quote_ident(ref_class.relname) = 'pg_ts_dict' and ref_ts_dict.oid is not null
      then 'tsDict:' || quote_ident(ref_ts_dict_ns.nspname) || '.' || quote_ident(ref_ts_dict.dictname)
    
    -- Text search template
    when quote_ident(ref_class.relname) = 'pg_ts_template' and ref_ts_template.oid is not null
      then 'tsTemplate:' || quote_ident(ref_ts_template_ns.nspname) || '.' || quote_ident(ref_ts_template.tmplname)
    
    -- Attribute defaults (column default values)
    when quote_ident(ref_class.relname) = 'pg_attrdef' and ref_attrdef.oid is not null and ref_attrdef_table.oid is not null
      then 'attrdef:' || quote_ident(ref_attrdef_table_ns.nspname) || '.' || quote_ident(ref_attrdef_table.relname) || '.' || ref_attrdef.adnum::text
    
    -- Default ACLs
    when quote_ident(ref_class.relname) = 'pg_default_acl' and ref_default_acl.oid is not null and ref_default_acl_ns.oid is not null
      then 'defaultAcl:' || quote_ident(ref_default_acl_ns.nspname) || '.' || ref_default_acl.defaclobjtype::text
    
    -- Event triggers
    when quote_ident(ref_class.relname) = 'pg_event_trigger' and ref_event_trigger.oid is not null
      then 'eventTrigger:' || quote_ident(ref_event_trigger.evtname)
    
    -- Extensions
    when quote_ident(ref_class.relname) = 'pg_extension' and ref_extension.oid is not null
      then 'extension:' || quote_ident(ref_extension.extname)
    
    else 'unknown:' || quote_ident(ref_class.relname) || '.' || d.refobjid::text
  end as referenced_stable_id,

  d.deptype

from
  pg_depend d

  -- Dependent object class
  join pg_class dep_class on d.classid = dep_class.oid
  -- Referenced object class
  join pg_class ref_class on d.refclassid = ref_class.oid

  -- Dependent object joins
  left join pg_class dep_obj on quote_ident(dep_class.relname) = 'pg_class' and d.objid = dep_obj.oid
  left join pg_namespace dep_ns on dep_obj.relnamespace = dep_ns.oid
  left join pg_namespace dep_namespace on quote_ident(dep_class.relname) = 'pg_namespace' and d.objid = dep_namespace.oid

  left join pg_type dep_type on quote_ident(dep_class.relname) = 'pg_type' and d.objid = dep_type.oid
  left join pg_namespace dep_type_ns on dep_type.typnamespace = dep_type_ns.oid

  left join pg_constraint dep_con on quote_ident(dep_class.relname) = 'pg_constraint' and d.objid = dep_con.oid
  left join pg_type dep_con_type on dep_con.contypid = dep_con_type.oid
  left join pg_namespace dep_con_type_ns on dep_con_type.typnamespace = dep_con_type_ns.oid
  left join pg_class dep_con_table on dep_con.conrelid = dep_con_table.oid
  left join pg_namespace dep_con_table_ns on dep_con_table.relnamespace = dep_con_table_ns.oid

  left join pg_policy dep_policy on quote_ident(dep_class.relname) = 'pg_policy' and d.objid = dep_policy.oid
  left join pg_class dep_policy_table on dep_policy.polrelid = dep_policy_table.oid
  left join pg_namespace dep_policy_table_ns on dep_policy_table.relnamespace = dep_policy_table_ns.oid

  left join pg_proc dep_proc on quote_ident(dep_class.relname) = 'pg_proc' and d.objid = dep_proc.oid
  left join pg_namespace dep_proc_ns on dep_proc.pronamespace = dep_proc_ns.oid

  left join pg_trigger dep_trigger on quote_ident(dep_class.relname) = 'pg_trigger' and d.objid = dep_trigger.oid
  left join pg_class dep_trigger_table on dep_trigger.tgrelid = dep_trigger_table.oid
  left join pg_namespace dep_trigger_table_ns on dep_trigger_table.relnamespace = dep_trigger_table_ns.oid

  -- Additional dependent object joins for new object types
  left join pg_language dep_language on quote_ident(dep_class.relname) = 'pg_language' and d.objid = dep_language.oid
  
  left join pg_rewrite dep_rewrite on quote_ident(dep_class.relname) = 'pg_rewrite' and d.objid = dep_rewrite.oid
  left join pg_class dep_rewrite_table on dep_rewrite.ev_class = dep_rewrite_table.oid
  left join pg_namespace dep_rewrite_table_ns on dep_rewrite_table.relnamespace = dep_rewrite_table_ns.oid
  
  left join pg_ts_config dep_ts_config on quote_ident(dep_class.relname) = 'pg_ts_config' and d.objid = dep_ts_config.oid
  left join pg_namespace dep_ts_config_ns on dep_ts_config.cfgnamespace = dep_ts_config_ns.oid
  
  left join pg_ts_dict dep_ts_dict on quote_ident(dep_class.relname) = 'pg_ts_dict' and d.objid = dep_ts_dict.oid
  left join pg_namespace dep_ts_dict_ns on dep_ts_dict.dictnamespace = dep_ts_dict_ns.oid
  
  left join pg_ts_template dep_ts_template on quote_ident(dep_class.relname) = 'pg_ts_template' and d.objid = dep_ts_template.oid
  left join pg_namespace dep_ts_template_ns on dep_ts_template.tmplnamespace = dep_ts_template_ns.oid

  -- Attribute defaults (column default values)
  left join pg_attrdef dep_attrdef on quote_ident(dep_class.relname) = 'pg_attrdef' and d.objid = dep_attrdef.oid
  left join pg_class dep_attrdef_table on dep_attrdef.adrelid = dep_attrdef_table.oid
  left join pg_namespace dep_attrdef_table_ns on dep_attrdef_table.relnamespace = dep_attrdef_table_ns.oid

  -- Additional system catalog objects
  left join pg_default_acl dep_default_acl on quote_ident(dep_class.relname) = 'pg_default_acl' and d.objid = dep_default_acl.oid
  left join pg_namespace dep_default_acl_ns on dep_default_acl.defaclnamespace = dep_default_acl_ns.oid
  
  left join pg_event_trigger dep_event_trigger on quote_ident(dep_class.relname) = 'pg_event_trigger' and d.objid = dep_event_trigger.oid
  
  left join pg_extension dep_extension on quote_ident(dep_class.relname) = 'pg_extension' and d.objid = dep_extension.oid

  -- Referenced object joins
  left join pg_class ref_obj on quote_ident(ref_class.relname) = 'pg_class' and d.refobjid = ref_obj.oid
  left join pg_namespace ref_ns on ref_obj.relnamespace = ref_ns.oid
  left join pg_namespace ref_namespace on quote_ident(ref_class.relname) = 'pg_namespace' and d.refobjid = ref_namespace.oid

  left join pg_type ref_type on quote_ident(ref_class.relname) = 'pg_type' and d.refobjid = ref_type.oid
  left join pg_namespace ref_type_ns on ref_type.typnamespace = ref_type_ns.oid

  left join pg_constraint ref_con on quote_ident(ref_class.relname) = 'pg_constraint' and d.refobjid = ref_con.oid
  left join pg_type ref_con_type on ref_con.contypid = ref_con_type.oid
  left join pg_namespace ref_con_type_ns on ref_con_type.typnamespace = ref_con_type_ns.oid
  left join pg_class ref_con_table on ref_con.conrelid = ref_con_table.oid
  left join pg_namespace ref_con_table_ns on ref_con_table.relnamespace = ref_con_table_ns.oid

  left join pg_policy ref_policy on quote_ident(ref_class.relname) = 'pg_policy' and d.refobjid = ref_policy.oid
  left join pg_class ref_policy_table on ref_policy.polrelid = ref_policy_table.oid
  left join pg_namespace ref_policy_table_ns on ref_policy_table.relnamespace = ref_policy_table_ns.oid

  left join pg_proc ref_proc on quote_ident(ref_class.relname) = 'pg_proc' and d.refobjid = ref_proc.oid
  left join pg_namespace ref_proc_ns on ref_proc.pronamespace = ref_proc_ns.oid

  left join pg_trigger ref_trigger on quote_ident(ref_class.relname) = 'pg_trigger' and d.refobjid = ref_trigger.oid
  left join pg_class ref_trigger_table on ref_trigger.tgrelid = ref_trigger_table.oid
  left join pg_namespace ref_trigger_table_ns on ref_trigger_table.relnamespace = ref_trigger_table_ns.oid

  -- Additional referenced object joins for new object types
  left join pg_language ref_language on quote_ident(ref_class.relname) = 'pg_language' and d.refobjid = ref_language.oid
  
  left join pg_rewrite ref_rewrite on quote_ident(ref_class.relname) = 'pg_rewrite' and d.refobjid = ref_rewrite.oid
  left join pg_class ref_rewrite_table on ref_rewrite.ev_class = ref_rewrite_table.oid
  left join pg_namespace ref_rewrite_table_ns on ref_rewrite_table.relnamespace = ref_rewrite_table_ns.oid
  
  left join pg_ts_config ref_ts_config on quote_ident(ref_class.relname) = 'pg_ts_config' and d.refobjid = ref_ts_config.oid
  left join pg_namespace ref_ts_config_ns on ref_ts_config.cfgnamespace = ref_ts_config_ns.oid
  
  left join pg_ts_dict ref_ts_dict on quote_ident(ref_class.relname) = 'pg_ts_dict' and d.refobjid = ref_ts_dict.oid
  left join pg_namespace ref_ts_dict_ns on ref_ts_dict.dictnamespace = ref_ts_dict_ns.oid
  
  left join pg_ts_template ref_ts_template on quote_ident(ref_class.relname) = 'pg_ts_template' and d.refobjid = ref_ts_template.oid
  left join pg_namespace ref_ts_template_ns on ref_ts_template.tmplnamespace = ref_ts_template_ns.oid

  -- Attribute defaults (column default values)
  left join pg_attrdef ref_attrdef on quote_ident(ref_class.relname) = 'pg_attrdef' and d.refobjid = ref_attrdef.oid
  left join pg_class ref_attrdef_table on ref_attrdef.adrelid = ref_attrdef_table.oid
  left join pg_namespace ref_attrdef_table_ns on ref_attrdef_table.relnamespace = ref_attrdef_table_ns.oid

  -- Additional system catalog objects
  left join pg_default_acl ref_default_acl on quote_ident(ref_class.relname) = 'pg_default_acl' and d.refobjid = ref_default_acl.oid
  left join pg_namespace ref_default_acl_ns on ref_default_acl.defaclnamespace = ref_default_acl_ns.oid
  
  left join pg_event_trigger ref_event_trigger on quote_ident(ref_class.relname) = 'pg_event_trigger' and d.refobjid = ref_event_trigger.oid
  
  left join pg_extension ref_extension on quote_ident(ref_class.relname) = 'pg_extension' and d.refobjid = ref_extension.oid

where
  d.deptype in ('n', 'a', 'i')
order by
  dependent_stable_id, referenced_stable_id
) as depends_rows
-- In some corner case (composite type) we can have the same stable ids in the case where an internal object depends on it's parent type
-- eg: compositeType contains internal columns but we don't distinct them from the parent type itself in our stable ids
where dependent_stable_id != referenced_stable_id


  `;

  // Also extract view dependencies from pg_rewrite
  const viewDepends = await extractViewAndMaterializedViewsDepends(sql);
  // Also extract table -> function dependencies (defaults/constraints)
  const tableFuncDepends = await extractTableAndConstraintFunctionDepends(sql);
  // Extract ownership dependencies (all objects depend on their owner roles)
  const ownershipDepends = await extractOwnershipDepends(sql);
  // Extract constraint-to-constraint dependencies (foreign key -> unique/primary key)
  const constraintDepends = await extractConstraintDepends(sql);

  // Combine all dependency sources and remove duplicates
  const allDepends = new Set([
    ...dependsRows,
    ...viewDepends,
    ...tableFuncDepends,
    ...ownershipDepends,
    ...constraintDepends,
  ]);

  return Array.from(allDepends).sort(
    (a, b) =>
      a.dependent_stable_id.localeCompare(b.dependent_stable_id) ||
      a.referenced_stable_id.localeCompare(b.referenced_stable_id),
  );
}
