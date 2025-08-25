import type { Sql } from "postgres";

export type PgDependType = "n" | "a" | "i";

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
   *   without dropping the whole referenced object. Example: a table's toast table or an index that’s part of a unique constraint.
   */
  deptype: PgDependType;
}

/**
 * Extract all dependencies from pg_depend, joining with pg_class for class names and applying user object filters.
 * @param sql - The SQL client.
 * @param params - Object containing arrays of OIDs for filtering (user_oids, user_namespace_oids, etc.)
 * @returns Array of dependency objects with class names.
 */
export async function extractDepends(sql: Sql): Promise<PgDepend[]> {
  const dependsRows = await sql<PgDepend[]>`
    select
  -- Dependent stable ID
  case
    -- Table
    when dep_class.relname = 'pg_class' and dep_obj.oid is not null and dep_obj.relkind = 'r'
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
      then 'policy:' || dep_policy_table_ns.nspname || '.' || dep_policy_table.relname || '.' || dep_policy.polname
    
    -- Function/Procedure
    when dep_class.relname = 'pg_proc' and dep_proc.oid is not null
      then 'function:' || dep_proc_ns.nspname || '.' || dep_proc.proname
    
    -- Trigger
    when dep_class.relname = 'pg_trigger' and dep_trigger.oid is not null and dep_trigger_table.oid is not null
      then 'trigger:' || dep_trigger_table_ns.nspname || '.' || dep_trigger_table.relname || '.' || dep_trigger.tgname
    else 'unknown:' || dep_class.relname || '.' || d.objid::text
  end as dependent_stable_id,

  -- Referenced stable ID
  case
    -- Table
    when ref_class.relname = 'pg_class' and ref_obj.oid is not null and ref_obj.relkind = 'r'
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
      then 'policy:' || ref_policy_table_ns.nspname || '.' || ref_policy_table.relname || '.' || ref_policy.polname
    -- Function/Procedure
    when ref_class.relname = 'pg_proc' and ref_proc.oid is not null
      then 'function:' || ref_proc_ns.nspname || '.' || ref_proc.proname
    -- Trigger
    when ref_class.relname = 'pg_trigger' and ref_trigger.oid is not null and ref_trigger_table.oid is not null
      then 'trigger:' || ref_trigger_table_ns.nspname || '.' || ref_trigger_table.relname || '.' || ref_trigger.tgname
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

  -- Referenced object joins
  left join pg_class ref_obj on ref_class.relname = 'pg_class' and d.refobjid = ref_obj.oid
  left join pg_namespace ref_ns on ref_obj.relnamespace = ref_ns.oid

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

where
  d.deptype in ('n', 'a', 'i')
order by
  dependent_stable_id, referenced_stable_id;
  `;
  return dependsRows;
}
