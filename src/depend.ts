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
          when v.relkind = 'v' then 'view:' || v_ns.nspname || '.' || v.relname
          when v.relkind = 'm' then 'materializedView:' || v_ns.nspname || '.' || v.relname
          else 'unknown:' || v.relname || ':' || v.relkind::text
        end as dependent_stable_id,
        case
          when ref_obj.relkind = 'r' then 'table:' || ref_ns.nspname || '.' || ref_obj.relname
          when ref_obj.relkind = 'v' then 'view:' || ref_ns.nspname || '.' || ref_obj.relname
          when ref_obj.relkind = 'm' then 'materializedview:' || ref_ns.nspname || '.' || ref_obj.relname
          else 'unknown:' || ref_obj.relname
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
      where c1.relname = 'pg_rewrite'
        and c2.relname = 'pg_class'
        and d.deptype = 'n'
        and c1.relnamespace = (select oid from pg_namespace where nspname = 'pg_catalog')
        and c2.relnamespace = (select oid from pg_namespace where nspname = 'pg_catalog')
      union all
      -- Views/materialized views depending on functions
      select distinct
        case
          when v.relkind = 'v' then 'view:' || v_ns.nspname || '.' || v.relname
          when v.relkind = 'm' then 'materializedView:' || v_ns.nspname || '.' || v.relname
          else 'unknown:' || v.relname || ':' || v.relkind::text
        end as dependent_stable_id,
        'procedure:' || ref_proc_ns.nspname || '.' || ref_proc.proname || '('
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
      where c1.relname = 'pg_rewrite'
        and c2.relname = 'pg_proc'
        and d.deptype = 'n'
        and c1.relnamespace = (select oid from pg_namespace where nspname = 'pg_catalog')
        and c2.relnamespace = (select oid from pg_namespace where nspname = 'pg_catalog')
    ) as view_depends_rows
    where dependent_stable_id != referenced_stable_id
  `;

  return dependsRows;
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
      'table:' || ns.nspname || '.' || tbl.relname as dependent_stable_id,
      'procedure:' || proc_ns.nspname || '.' || proc.proname || '('
        || coalesce(
          (
            select string_agg(format_type(oid, null), ',' order by ord)
            from unnest(proc.proargtypes) with ordinality as t(oid, ord)
          ),
          ''
        ) || ')' as referenced_stable_id,
      d.deptype
    from pg_depend d
    join pg_class c_dep on d.classid = c_dep.oid and c_dep.relname = 'pg_attrdef'
    join pg_attrdef ad on d.objid = ad.oid
    join pg_class tbl on ad.adrelid = tbl.oid
    join pg_namespace ns on tbl.relnamespace = ns.oid
    join pg_class c_ref on d.refclassid = c_ref.oid and c_ref.relname = 'pg_proc'
    join pg_proc proc on d.refobjid = proc.oid
    join pg_namespace proc_ns on proc.pronamespace = proc_ns.oid
    where d.deptype = 'n'
    union all
    -- Table depends on function via CHECK constraint expression
    select distinct
      'table:' || ns.nspname || '.' || tbl.relname as dependent_stable_id,
      'procedure:' || proc_ns.nspname || '.' || proc.proname || '('
        || coalesce(
          (
            select string_agg(format_type(oid, null), ',' order by ord)
            from unnest(proc.proargtypes) with ordinality as t(oid, ord)
          ),
          ''
        ) || ')' as referenced_stable_id,
      d.deptype
    from pg_depend d
    join pg_class c_dep on d.classid = c_dep.oid and c_dep.relname = 'pg_constraint'
    join pg_constraint con on d.objid = con.oid and con.conrelid <> 0
    join pg_class tbl on con.conrelid = tbl.oid
    join pg_namespace ns on tbl.relnamespace = ns.oid
    join pg_class c_ref on d.refclassid = c_ref.oid and c_ref.relname = 'pg_proc'
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
    when dep_class.relname = 'pg_namespace' and dep_namespace.oid is not null
      then 'schema:' || dep_namespace.nspname
    -- Table
    when dep_class.relname = 'pg_class' and dep_obj.oid is not null and dep_obj.relkind in ('r','p')
      then 'table:' || dep_ns.nspname || '.' || dep_obj.relname
    
    -- View
    when dep_class.relname = 'pg_class' and dep_obj.oid is not null and dep_obj.relkind = 'v'
      then 'view:' || dep_ns.nspname || '.' || dep_obj.relname
    
    -- Materialized View
    when dep_class.relname = 'pg_class' and dep_obj.oid is not null and dep_obj.relkind = 'm'
      then 'materializedView:' || dep_ns.nspname || '.' || dep_obj.relname
    
    -- Sequence
    when dep_class.relname = 'pg_class' and dep_obj.oid is not null and dep_obj.relkind = 'S'
      then 'sequence:' || dep_ns.nspname || '.' || dep_obj.relname
    
    -- Index
    when dep_class.relname = 'pg_class' and dep_obj.oid is not null and dep_obj.relkind = 'i'
      then 'index:' || dep_ns.nspname || '.' || dep_obj.relname
    
    -- System catalog tables (information_schema, pg_catalog, etc.)
    when dep_class.relname = 'pg_class' and dep_obj.oid is not null and dep_obj.relkind = 'r' and dep_ns.nspname in ('information_schema', 'pg_catalog', 'pg_toast')
      then 'systemTable:' || dep_ns.nspname || '.' || dep_obj.relname
    
    -- System catalog views (information_schema, pg_catalog, etc.)
    when dep_class.relname = 'pg_class' and dep_obj.oid is not null and dep_obj.relkind = 'v' and dep_ns.nspname in ('information_schema', 'pg_catalog', 'pg_toast')
      then 'systemView:' || dep_ns.nspname || '.' || dep_obj.relname
    
    -- System catalog sequences (information_schema, pg_catalog, etc.)
    when dep_class.relname = 'pg_class' and dep_obj.oid is not null and dep_obj.relkind = 'S' and dep_ns.nspname in ('information_schema', 'pg_catalog', 'pg_toast')
      then 'systemSequence:' || dep_ns.nspname || '.' || dep_obj.relname
    
    -- System catalog indexes (information_schema, pg_catalog, etc.)
    when dep_class.relname = 'pg_class' and dep_obj.oid is not null and dep_obj.relkind = 'i' and dep_ns.nspname in ('information_schema', 'pg_catalog', 'pg_toast')
      then 'systemIndex:' || dep_ns.nspname || '.' || dep_obj.relname
    
    -- Handle any remaining pg_class objects with unknown relkind values
    when dep_class.relname = 'pg_class' and dep_obj.oid is not null and dep_ns.nspname in ('information_schema', 'pg_catalog', 'pg_toast')
      then 'systemObject:' || dep_ns.nspname || '.' || dep_obj.relname || ':' || dep_obj.relkind::text
    
    -- Types
    -- Domain
    when dep_class.relname = 'pg_type' and dep_type.oid is not null and dep_type.typtype = 'd'
      then 'domain:' || dep_type_ns.nspname || '.' || dep_type.typname
    -- Enum
    when dep_class.relname = 'pg_type' and dep_type.oid is not null and dep_type.typtype = 'e'
      then 'enum:' || dep_type_ns.nspname || '.' || dep_type.typname
    -- Range type
    when dep_class.relname = 'pg_type' and dep_type.oid is not null and dep_type.typtype = 'r'
      then 'range:' || dep_type_ns.nspname || '.' || dep_type.typname
    -- Multirange type
    when dep_class.relname = 'pg_type' and dep_type.oid is not null and dep_type.typtype = 'm'
      then 'multirange:' || dep_type_ns.nspname || '.' || dep_type.typname
    -- Composite type
    when dep_class.relname = 'pg_type' and dep_type.oid is not null and dep_type.typtype = 'c'
      then 'compositeType:' || dep_type_ns.nspname || '.' || dep_type.typname
    -- When a composite type is created sub-elements references are stored in pg_class (columsn of the composite type)
    when dep_class.relname = 'pg_class' and dep_obj.oid is not null and dep_obj.relkind = 'c'
      then 'compositeType:' || dep_ns.nspname || '.' || dep_obj.relname
    -- Base type
    when dep_class.relname = 'pg_type' and dep_type.oid is not null and dep_type.typtype = 'b'
      then 'type:' || dep_type_ns.nspname || '.' || dep_type.typname
    -- Pseudo-type
    when dep_class.relname = 'pg_type' and dep_type.oid is not null and dep_type.typtype = 'p'
      then 'pseudoType:' || dep_type_ns.nspname || '.' || dep_type.typname

    -- Constraint on domain
    when dep_class.relname = 'pg_constraint' and dep_con.oid is not null and dep_con.contypid != 0 and dep_con_type.oid is not null
      then 'constraint:' || dep_con_type_ns.nspname || '.' || dep_con_type.typname || '.' || dep_con.conname
    -- Constraint on table
    when dep_class.relname = 'pg_constraint' and dep_con.oid is not null and dep_con.conrelid != 0 and dep_con_table.oid is not null
      then 'constraint:' || dep_con_table_ns.nspname || '.' || dep_con_table.relname || '.' || dep_con.conname
    
    -- Policy
    when dep_class.relname = 'pg_policy' and dep_policy.oid is not null and dep_policy_table.oid is not null
      then 'rlsPolicy:' || dep_policy_table_ns.nspname || '.' || dep_policy_table.relname || '.' || dep_policy.polname
    
    -- Function/Procedure (include identity argument types for overload distinction)
    when dep_class.relname = 'pg_proc' and dep_proc.oid is not null
      then 'procedure:' || dep_proc_ns.nspname || '.' || dep_proc.proname || '('
        || coalesce(
          (
            select string_agg(format_type(oid, null), ',' order by ord)
            from unnest(dep_proc.proargtypes) with ordinality as t(oid, ord)
          ),
          ''
        )
        || ')'
    
    -- Trigger
    when dep_class.relname = 'pg_trigger' and dep_trigger.oid is not null and dep_trigger_table.oid is not null
      then 'trigger:' || dep_trigger_table_ns.nspname || '.' || dep_trigger_table.relname || '.' || dep_trigger.tgname
    
    -- Language
    when dep_class.relname = 'pg_language' and dep_language.oid is not null
      then 'language:' || dep_language.lanname
    
    -- Rewrite rule
    when dep_class.relname = 'pg_rewrite' and dep_rewrite.oid is not null and dep_rewrite_table.oid is not null
      then 'rewriteRule:' || dep_rewrite_table_ns.nspname || '.' || dep_rewrite_table.relname || '.' || dep_rewrite.rulename
    
    -- Text search configuration
    when dep_class.relname = 'pg_ts_config' and dep_ts_config.oid is not null
      then 'tsConfig:' || dep_ts_config_ns.nspname || '.' || dep_ts_config.cfgname
    
    -- Text search dictionary
    when dep_class.relname = 'pg_ts_dict' and dep_ts_dict.oid is not null
      then 'tsDict:' || dep_ts_dict_ns.nspname || '.' || dep_ts_dict.dictname
    
    -- Text search template
    when dep_class.relname = 'pg_ts_template' and dep_ts_template.oid is not null
      then 'tsTemplate:' || dep_ts_template_ns.nspname || '.' || dep_ts_template.tmplname
    
    -- Attribute defaults (column default values)
    when dep_class.relname = 'pg_attrdef' and dep_attrdef.oid is not null and dep_attrdef_table.oid is not null
      then 'attrdef:' || dep_attrdef_table_ns.nspname || '.' || dep_attrdef_table.relname || '.' || dep_attrdef.adnum::text
    
    -- Default ACLs
    when dep_class.relname = 'pg_default_acl' and dep_default_acl.oid is not null and dep_default_acl_ns.oid is not null
      then 'defaultAcl:' || dep_default_acl_ns.nspname || '.' || dep_default_acl.defaclobjtype::text
    
    -- Event triggers
    when dep_class.relname = 'pg_event_trigger' and dep_event_trigger.oid is not null
      then 'eventTrigger:' || dep_event_trigger.evtname
    
    -- Extensions
    when dep_class.relname = 'pg_extension' and dep_extension.oid is not null
      then 'extension:' || dep_extension.extname
    
    else 'unknown:' || dep_class.relname || '.' || d.objid::text
  end as dependent_stable_id,

  -- Referenced stable ID
  case
    -- Schema (namespace)
    when ref_class.relname = 'pg_namespace' and ref_namespace.oid is not null
      then 'schema:' || ref_namespace.nspname
    -- Table
    when ref_class.relname = 'pg_class' and ref_obj.oid is not null and ref_obj.relkind in ('r','p')
      then 'table:' || ref_ns.nspname || '.' || ref_obj.relname
    -- View
    when ref_class.relname = 'pg_class' and ref_obj.oid is not null and ref_obj.relkind = 'v'
      then 'view:' || ref_ns.nspname || '.' || ref_obj.relname
    -- Materialized View
    when ref_class.relname = 'pg_class' and ref_obj.oid is not null and ref_obj.relkind = 'm'
      then 'materializedView:' || ref_ns.nspname || '.' || ref_obj.relname
    -- Sequence
    when ref_class.relname = 'pg_class' and ref_obj.oid is not null and ref_obj.relkind = 'S'
      then 'sequence:' || ref_ns.nspname || '.' || ref_obj.relname
    -- Index
    when ref_class.relname = 'pg_class' and ref_obj.oid is not null and ref_obj.relkind = 'i'
      then 'index:' || ref_ns.nspname || '.' || ref_obj.relname
    -- System catalog tables (information_schema, pg_catalog, etc.)
    when ref_class.relname = 'pg_class' and ref_obj.oid is not null and ref_obj.relkind = 'r' and ref_ns.nspname in ('information_schema', 'pg_catalog', 'pg_toast')
      then 'systemTable:' || ref_ns.nspname || '.' || ref_obj.relname
    -- System catalog views (information_schema, pg_catalog, etc.)
    when ref_class.relname = 'pg_class' and ref_obj.oid is not null and ref_obj.relkind = 'v' and ref_ns.nspname in ('information_schema', 'pg_catalog', 'pg_toast')
      then 'systemView:' || ref_ns.nspname || '.' || ref_obj.relname
    -- System catalog sequences (information_schema, pg_catalog, etc.)
    when ref_class.relname = 'pg_class' and ref_obj.oid is not null and ref_obj.relkind = 'S' and ref_ns.nspname in ('information_schema', 'pg_catalog', 'pg_toast')
      then 'systemSequence:' || ref_ns.nspname || '.' || ref_obj.relname
    -- System catalog indexes (information_schema, pg_catalog, etc.)
    when ref_class.relname = 'pg_class' and ref_obj.oid is not null and ref_obj.relkind = 'i' and ref_ns.nspname in ('information_schema', 'pg_catalog', 'pg_toast')
      then 'systemIndex:' || ref_ns.nspname || '.' || ref_obj.relname
    -- Handle any remaining pg_class objects with unknown relkind values
    when ref_class.relname = 'pg_class' and ref_obj.oid is not null and ref_ns.nspname in ('information_schema', 'pg_catalog', 'pg_toast')
      then 'systemObject:' || ref_ns.nspname || '.' || ref_obj.relname || ':' || ref_obj.relkind::text
    -- Composite Type
    when ref_class.relname = 'pg_type' and ref_type.oid is not null and ref_type.typtype = 'd'
      then 'domain:' || ref_type_ns.nspname || '.' || ref_type.typname
    when ref_class.relname = 'pg_type' and ref_type.oid is not null and ref_type.typtype = 'e'
      then 'enum:' || ref_type_ns.nspname || '.' || ref_type.typname
    when ref_class.relname = 'pg_type' and ref_type.oid is not null and ref_type.typtype = 'r'
      then 'range:' || ref_type_ns.nspname || '.' || ref_type.typname
    when ref_class.relname = 'pg_type' and ref_type.oid is not null and ref_type.typtype = 'm'
      then 'multirange:' || ref_type_ns.nspname || '.' || ref_type.typname
    when ref_class.relname = 'pg_type' and ref_type.oid is not null and ref_type.typtype = 'c'
      then 'compositeType:' || ref_type_ns.nspname || '.' || ref_type.typname
    -- When a composite type is created sub-elements references are stored in pg_class (columsn of the composite type)
    when ref_class.relname = 'pg_class' and ref_obj.oid is not null and ref_obj.relkind = 'c'
      then 'compositeType:' || ref_ns.nspname || '.' || ref_obj.relname
    when ref_class.relname = 'pg_type' and ref_type.oid is not null and ref_type.typtype = 'b'
      then 'type:' || ref_type_ns.nspname || '.' || ref_type.typname
    when ref_class.relname = 'pg_type' and ref_type.oid is not null
      then 'type:' || ref_type_ns.nspname || '.' || ref_type.typname
    -- Constraint on domain
    when ref_class.relname = 'pg_constraint' and ref_con.oid is not null and ref_con.contypid != 0 and ref_con_type.oid is not null
      then 'constraint:' || ref_con_type_ns.nspname || '.' || ref_con_type.typname || '.' || ref_con.conname
    -- Constraint on table
    when ref_class.relname = 'pg_constraint' and ref_con.oid is not null and ref_con.conrelid != 0 and ref_con_table.oid is not null
      then 'constraint:' || ref_con_table_ns.nspname || '.' || ref_con_table.relname || '.' || ref_con.conname
    -- Policy
    when ref_class.relname = 'pg_policy' and ref_policy.oid is not null and ref_policy_table.oid is not null
      then 'rlsPolicy:' || ref_policy_table_ns.nspname || '.' || ref_policy_table.relname || '.' || ref_policy.polname
    -- Function/Procedure
    when ref_class.relname = 'pg_proc' and ref_proc.oid is not null
      then 'procedure:' || ref_proc_ns.nspname || '.' || ref_proc.proname || '('
        || coalesce(
          (
            select string_agg(format_type(oid, null), ',' order by ord)
            from unnest(ref_proc.proargtypes) with ordinality as t(oid, ord)
          ),
          ''
        )
        || ')'
    -- Trigger
    when ref_class.relname = 'pg_trigger' and ref_trigger.oid is not null and ref_trigger_table.oid is not null
      then 'trigger:' || ref_trigger_table_ns.nspname || '.' || ref_trigger_table.relname || '.' || ref_trigger.tgname
    
    -- Language
    when ref_class.relname = 'pg_language' and ref_language.oid is not null
      then 'language:' || ref_language.lanname
    
    -- Rewrite rule
    when ref_class.relname = 'pg_rewrite' and ref_rewrite.oid is not null and ref_rewrite_table.oid is not null
      then 'rewriteRule:' || ref_rewrite_table_ns.nspname || '.' || ref_rewrite_table.relname || '.' || ref_rewrite.rulename
    
    -- Text search configuration
    when ref_class.relname = 'pg_ts_config' and ref_ts_config.oid is not null
      then 'tsConfig:' || ref_ts_config_ns.nspname || '.' || ref_ts_config.cfgname
    
    -- Text search dictionary
    when ref_class.relname = 'pg_ts_dict' and ref_ts_dict.oid is not null
      then 'tsDict:' || ref_ts_dict_ns.nspname || '.' || ref_ts_dict.dictname
    
    -- Text search template
    when ref_class.relname = 'pg_ts_template' and ref_ts_template.oid is not null
      then 'tsTemplate:' || ref_ts_template_ns.nspname || '.' || ref_ts_template.tmplname
    
    -- Attribute defaults (column default values)
    when ref_class.relname = 'pg_attrdef' and ref_attrdef.oid is not null and ref_attrdef_table.oid is not null
      then 'attrdef:' || ref_attrdef_table_ns.nspname || '.' || ref_attrdef_table.relname || '.' || ref_attrdef.adnum::text
    
    -- Default ACLs
    when ref_class.relname = 'pg_default_acl' and ref_default_acl.oid is not null and ref_default_acl_ns.oid is not null
      then 'defaultAcl:' || ref_default_acl_ns.nspname || '.' || ref_default_acl.defaclobjtype::text
    
    -- Event triggers
    when ref_class.relname = 'pg_event_trigger' and ref_event_trigger.oid is not null
      then 'eventTrigger:' || ref_event_trigger.evtname
    
    -- Extensions
    when ref_class.relname = 'pg_extension' and ref_extension.oid is not null
      then 'extension:' || ref_extension.extname
    
    else 'unknown:' || ref_class.relname || '.' || d.refobjid::text
  end as referenced_stable_id,

  d.deptype

from
  pg_depend d

  -- Dependent object class
  join pg_class dep_class on d.classid = dep_class.oid
  -- Referenced object class
  join pg_class ref_class on d.refclassid = ref_class.oid

  -- Dependent object joins
  left join pg_class dep_obj on dep_class.relname = 'pg_class' and d.objid = dep_obj.oid
  left join pg_namespace dep_ns on dep_obj.relnamespace = dep_ns.oid
  left join pg_namespace dep_namespace on dep_class.relname = 'pg_namespace' and d.objid = dep_namespace.oid

  left join pg_type dep_type on dep_class.relname = 'pg_type' and d.objid = dep_type.oid
  left join pg_namespace dep_type_ns on dep_type.typnamespace = dep_type_ns.oid

  left join pg_constraint dep_con on dep_class.relname = 'pg_constraint' and d.objid = dep_con.oid
  left join pg_type dep_con_type on dep_con.contypid = dep_con_type.oid
  left join pg_namespace dep_con_type_ns on dep_con_type.typnamespace = dep_con_type_ns.oid
  left join pg_class dep_con_table on dep_con.conrelid = dep_con_table.oid
  left join pg_namespace dep_con_table_ns on dep_con_table.relnamespace = dep_con_table_ns.oid

  left join pg_policy dep_policy on dep_class.relname = 'pg_policy' and d.objid = dep_policy.oid
  left join pg_class dep_policy_table on dep_policy.polrelid = dep_policy_table.oid
  left join pg_namespace dep_policy_table_ns on dep_policy_table.relnamespace = dep_policy_table_ns.oid

  left join pg_proc dep_proc on dep_class.relname = 'pg_proc' and d.objid = dep_proc.oid
  left join pg_namespace dep_proc_ns on dep_proc.pronamespace = dep_proc_ns.oid

  left join pg_trigger dep_trigger on dep_class.relname = 'pg_trigger' and d.objid = dep_trigger.oid
  left join pg_class dep_trigger_table on dep_trigger.tgrelid = dep_trigger_table.oid
  left join pg_namespace dep_trigger_table_ns on dep_trigger_table.relnamespace = dep_trigger_table_ns.oid

  -- Additional dependent object joins for new object types
  left join pg_language dep_language on dep_class.relname = 'pg_language' and d.objid = dep_language.oid
  
  left join pg_rewrite dep_rewrite on dep_class.relname = 'pg_rewrite' and d.objid = dep_rewrite.oid
  left join pg_class dep_rewrite_table on dep_rewrite.ev_class = dep_rewrite_table.oid
  left join pg_namespace dep_rewrite_table_ns on dep_rewrite_table.relnamespace = dep_rewrite_table_ns.oid
  
  left join pg_ts_config dep_ts_config on dep_class.relname = 'pg_ts_config' and d.objid = dep_ts_config.oid
  left join pg_namespace dep_ts_config_ns on dep_ts_config.cfgnamespace = dep_ts_config_ns.oid
  
  left join pg_ts_dict dep_ts_dict on dep_class.relname = 'pg_ts_dict' and d.objid = dep_ts_dict.oid
  left join pg_namespace dep_ts_dict_ns on dep_ts_dict.dictnamespace = dep_ts_dict_ns.oid
  
  left join pg_ts_template dep_ts_template on dep_class.relname = 'pg_ts_template' and d.objid = dep_ts_template.oid
  left join pg_namespace dep_ts_template_ns on dep_ts_template.tmplnamespace = dep_ts_template_ns.oid

  -- Attribute defaults (column default values)
  left join pg_attrdef dep_attrdef on dep_class.relname = 'pg_attrdef' and d.objid = dep_attrdef.oid
  left join pg_class dep_attrdef_table on dep_attrdef.adrelid = dep_attrdef_table.oid
  left join pg_namespace dep_attrdef_table_ns on dep_attrdef_table.relnamespace = dep_attrdef_table_ns.oid

  -- Additional system catalog objects
  left join pg_default_acl dep_default_acl on dep_class.relname = 'pg_default_acl' and d.objid = dep_default_acl.oid
  left join pg_namespace dep_default_acl_ns on dep_default_acl.defaclnamespace = dep_default_acl_ns.oid
  
  left join pg_event_trigger dep_event_trigger on dep_class.relname = 'pg_event_trigger' and d.objid = dep_event_trigger.oid
  
  left join pg_extension dep_extension on dep_class.relname = 'pg_extension' and d.objid = dep_extension.oid

  -- Referenced object joins
  left join pg_class ref_obj on ref_class.relname = 'pg_class' and d.refobjid = ref_obj.oid
  left join pg_namespace ref_ns on ref_obj.relnamespace = ref_ns.oid
  left join pg_namespace ref_namespace on ref_class.relname = 'pg_namespace' and d.refobjid = ref_namespace.oid

  left join pg_type ref_type on ref_class.relname = 'pg_type' and d.refobjid = ref_type.oid
  left join pg_namespace ref_type_ns on ref_type.typnamespace = ref_type_ns.oid

  left join pg_constraint ref_con on ref_class.relname = 'pg_constraint' and d.refobjid = ref_con.oid
  left join pg_type ref_con_type on ref_con.contypid = ref_con_type.oid
  left join pg_namespace ref_con_type_ns on ref_con_type.typnamespace = ref_con_type_ns.oid
  left join pg_class ref_con_table on ref_con.conrelid = ref_con_table.oid
  left join pg_namespace ref_con_table_ns on ref_con_table.relnamespace = ref_con_table_ns.oid

  left join pg_policy ref_policy on ref_class.relname = 'pg_policy' and d.refobjid = ref_policy.oid
  left join pg_class ref_policy_table on ref_policy.polrelid = ref_policy_table.oid
  left join pg_namespace ref_policy_table_ns on ref_policy_table.relnamespace = ref_policy_table_ns.oid

  left join pg_proc ref_proc on ref_class.relname = 'pg_proc' and d.refobjid = ref_proc.oid
  left join pg_namespace ref_proc_ns on ref_proc.pronamespace = ref_proc_ns.oid

  left join pg_trigger ref_trigger on ref_class.relname = 'pg_trigger' and d.refobjid = ref_trigger.oid
  left join pg_class ref_trigger_table on ref_trigger.tgrelid = ref_trigger_table.oid
  left join pg_namespace ref_trigger_table_ns on ref_trigger_table.relnamespace = ref_trigger_table_ns.oid

  -- Additional referenced object joins for new object types
  left join pg_language ref_language on ref_class.relname = 'pg_language' and d.refobjid = ref_language.oid
  
  left join pg_rewrite ref_rewrite on ref_class.relname = 'pg_rewrite' and d.refobjid = ref_rewrite.oid
  left join pg_class ref_rewrite_table on ref_rewrite.ev_class = ref_rewrite_table.oid
  left join pg_namespace ref_rewrite_table_ns on ref_rewrite_table.relnamespace = ref_rewrite_table_ns.oid
  
  left join pg_ts_config ref_ts_config on ref_class.relname = 'pg_ts_config' and d.refobjid = ref_ts_config.oid
  left join pg_namespace ref_ts_config_ns on ref_ts_config.cfgnamespace = ref_ts_config_ns.oid
  
  left join pg_ts_dict ref_ts_dict on ref_class.relname = 'pg_ts_dict' and d.refobjid = ref_ts_dict.oid
  left join pg_namespace ref_ts_dict_ns on ref_ts_dict.dictnamespace = ref_ts_dict_ns.oid
  
  left join pg_ts_template ref_ts_template on ref_class.relname = 'pg_ts_template' and d.refobjid = ref_ts_template.oid
  left join pg_namespace ref_ts_template_ns on ref_ts_template.tmplnamespace = ref_ts_template_ns.oid

  -- Attribute defaults (column default values)
  left join pg_attrdef ref_attrdef on ref_class.relname = 'pg_attrdef' and d.refobjid = ref_attrdef.oid
  left join pg_class ref_attrdef_table on ref_attrdef.adrelid = ref_attrdef_table.oid
  left join pg_namespace ref_attrdef_table_ns on ref_attrdef_table.relnamespace = ref_attrdef_table_ns.oid

  -- Additional system catalog objects
  left join pg_default_acl ref_default_acl on ref_class.relname = 'pg_default_acl' and d.refobjid = ref_default_acl.oid
  left join pg_namespace ref_default_acl_ns on ref_default_acl.defaclnamespace = ref_default_acl_ns.oid
  
  left join pg_event_trigger ref_event_trigger on ref_class.relname = 'pg_event_trigger' and d.refobjid = ref_event_trigger.oid
  
  left join pg_extension ref_extension on ref_class.relname = 'pg_extension' and d.refobjid = ref_extension.oid

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

  // Combine both dependency sources and remove duplicates
  const allDepends = new Set([
    ...dependsRows,
    ...viewDepends,
    ...tableFuncDepends,
  ]);

  return Array.from(allDepends).sort(
    (a, b) =>
      a.dependent_stable_id.localeCompare(b.dependent_stable_id) ||
      a.referenced_stable_id.localeCompare(b.referenced_stable_id),
  );
}
