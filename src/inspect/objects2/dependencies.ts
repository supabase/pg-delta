import type { Sql } from "postgres";

// PostgreSQL dependency class types
export type DependencyClass =
  /** pg_class */
  | "pg_class"
  /** pg_type */
  | "pg_type"
  /** pg_proc */
  | "pg_proc"
  /** pg_constraint */
  | "pg_constraint"
  /** pg_trigger */
  | "pg_trigger"
  /** pg_policy */
  | "pg_policy"
  /** pg_namespace */
  | "pg_namespace"
  /** pg_collation */
  | "pg_collation";

// PostgreSQL dependency type
export type DependencyType =
  /** normal */
  | "n"
  /** auto */
  | "a"
  /** internal */
  | "i"
  /** extension */
  | "e"
  /** pin */
  | "p";

export interface InspectedDependency {
  dependent_class: DependencyClass;
  dependent_object: string;
  dependent_subobject: number | null;
  referenced_class: DependencyClass;
  referenced_object: string;
  referenced_subobject: number | null;
  dependency_type: DependencyType;
}

export async function inspectDependencies(
  sql: Sql,
): Promise<InspectedDependency[]> {
  const dependencies = await sql<InspectedDependency[]>`
with extension_oids as (
  select
    objid
  from
    pg_depend d
  where
    d.refclassid = 'pg_extension'::regclass
)
select
  d.classid::regclass::text as dependent_class,
  case d.classid
    when 'pg_class'::regclass then c.relname
    when 'pg_type'::regclass then t.typname
    when 'pg_proc'::regclass then p.proname
    when 'pg_constraint'::regclass then con.conname
    when 'pg_trigger'::regclass then tr.tgname
    when 'pg_policy'::regclass then pol.polname
    when 'pg_namespace'::regclass then n.nspname
    when 'pg_collation'::regclass then col.collname
    else d.objid::text
  end as dependent_object,
  d.objsubid as dependent_subobject,
  d.refclassid::regclass::text as referenced_class,
  case d.refclassid
    when 'pg_class'::regclass then rc.relname
    when 'pg_type'::regclass then rt.typname
    when 'pg_proc'::regclass then rp.proname
    when 'pg_constraint'::regclass then rcon.conname
    when 'pg_trigger'::regclass then rtr.tgname
    when 'pg_policy'::regclass then rpol.polname
    when 'pg_namespace'::regclass then rn.nspname
    when 'pg_collation'::regclass then rcol.collname
    else d.refobjid::text
  end as referenced_object,
  d.refobjsubid as referenced_subobject,
  d.deptype as dependency_type
from
  pg_catalog.pg_depend d
  left join pg_catalog.pg_class c on c.oid = d.objid and d.classid = 'pg_class'::regclass
  left join pg_catalog.pg_type t on t.oid = d.objid and d.classid = 'pg_type'::regclass
  left join pg_catalog.pg_proc p on p.oid = d.objid and d.classid = 'pg_proc'::regclass
  left join pg_catalog.pg_constraint con on con.oid = d.objid and d.classid = 'pg_constraint'::regclass
  left join pg_catalog.pg_trigger tr on tr.oid = d.objid and d.classid = 'pg_trigger'::regclass
  left join pg_catalog.pg_policy pol on pol.oid = d.objid and d.classid = 'pg_policy'::regclass
  left join pg_catalog.pg_namespace n on n.oid = d.objid and d.classid = 'pg_namespace'::regclass
  left join pg_catalog.pg_collation col on col.oid = d.objid and d.classid = 'pg_collation'::regclass
  left join pg_catalog.pg_class rc on rc.oid = d.refobjid and d.refclassid = 'pg_class'::regclass
  left join pg_catalog.pg_type rt on rt.oid = d.refobjid and d.refclassid = 'pg_type'::regclass
  left join pg_catalog.pg_proc rp on rp.oid = d.refobjid and d.refclassid = 'pg_proc'::regclass
  left join pg_catalog.pg_constraint rcon on rcon.oid = d.refobjid and d.refclassid = 'pg_constraint'::regclass
  left join pg_catalog.pg_trigger rtr on rtr.oid = d.refobjid and d.refclassid = 'pg_trigger'::regclass
  left join pg_catalog.pg_policy rpol on rpol.oid = d.refobjid and d.refclassid = 'pg_policy'::regclass
  left join pg_catalog.pg_namespace rn on rn.oid = d.refobjid and d.refclassid = 'pg_namespace'::regclass
  left join pg_catalog.pg_collation rcol on rcol.oid = d.refobjid and d.refclassid = 'pg_collation'::regclass
  left outer join extension_oids e on d.objid = e.objid
  -- <EXCLUDE_INTERNAL>
  where e.objid is null
  -- </EXCLUDE_INTERNAL>
order by
  1, 2, 3;
  `;

  return dependencies;
}
