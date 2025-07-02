import type { Sql } from "postgres";
import { DEPENDENCY_KIND_PREFIX } from "./constants.js";
import type { InspectionMap } from "./types.ts";

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

// PostgreSQL dependency kind (relation type)
export type DependencyKind =
  /** table */
  | "r"
  /** view */
  | "v"
  /** materialized view */
  | "m"
  /** composite type */
  | "c"
  /** function */
  | "f";

export interface InspectedDependency {
  schema: string;
  name: string;
  identity_arguments: string | null;
  kind: DependencyKind;
  schema_dependent_on: string;
  name_dependent_on: string;
  identity_arguments_dependent_on: string | null;
  kind_dependent_on: DependencyKind;
}

export async function inspectDependencies(
  sql: Sql,
): Promise<InspectedDependency[]> {
  const dependencies = await sql<InspectedDependency[]>`
with things1 as (
  select
    oid as objid,
    pronamespace as namespace,
    proname as name,
    pg_get_function_identity_arguments(oid) as identity_arguments,
    'f' as kind
  from pg_proc
  union
  select
    oid,
    relnamespace as namespace,
    relname as name,
    null as identity_arguments,
    relkind as kind
  from pg_class
  where oid not in (
    select ftrelid from pg_foreign_table
  )
),
extension_objids as (
  select
      objid as extension_objid
  from
      pg_depend d
  WHERE
      d.refclassid = 'pg_extension'::regclass
    union
    select
        t.typrelid as extension_objid
    from
        pg_depend d
        join pg_type t on t.oid = d.objid
    where
        d.refclassid = 'pg_extension'::regclass
),
things as (
    select
      objid,
      kind,
      n.nspname as schema,
      name,
      identity_arguments
    from things1 t
    inner join pg_namespace n
      on t.namespace = n.oid
    left outer join extension_objids
      on t.objid = extension_objids.extension_objid
    where
      kind in ('r', 'v', 'm', 'c', 'f') and
      n.nspname not in ('pg_internal', 'pg_catalog', 'information_schema', 'pg_toast')
      and n.nspname not like 'pg_temp_%' and n.nspname not like 'pg_toast_temp_%'
      and extension_objids.extension_objid is null
),
combined as (
  select distinct
    t.schema,
    t.name,
    t.identity_arguments,
    t.kind,
    things_dependent_on.schema as schema_dependent_on,
    things_dependent_on.name as name_dependent_on,
    things_dependent_on.identity_arguments as identity_arguments_dependent_on,
    things_dependent_on.kind as kind_dependent_on
  FROM
      pg_depend d
      inner join things things_dependent_on
        on d.refobjid = things_dependent_on.objid
      inner join pg_rewrite rw
        on d.objid = rw.oid
        and things_dependent_on.objid != rw.ev_class
      inner join things t
        on rw.ev_class = t.objid
  where
    d.deptype in ('n')
    and
    rw.rulename = '_RETURN'
)
select
  *
from combined
order by
schema, name, identity_arguments, kind_dependent_on,
schema_dependent_on, name_dependent_on, identity_arguments_dependent_on
  `;

  return dependencies;
}

export async function buildDependencies(sql: Sql, inspection: InspectionMap) {
  const dependencies = await inspectDependencies(sql);

  for (const dependency of dependencies) {
    const identity = identifyDependency(
      dependency.kind,
      dependency.schema,
      dependency.name,
      dependency.identity_arguments,
    );
    const identityDependentOn = identifyDependency(
      dependency.kind_dependent_on,
      dependency.schema_dependent_on,
      dependency.name_dependent_on,
      dependency.identity_arguments_dependent_on,
    );
    const object = inspection[identity];
    const objectDependentOn = inspection[identityDependentOn];

    if (object && objectDependentOn) {
      object.dependent_on.push(identityDependentOn);
      objectDependentOn.dependents.push(identity);
    }
  }
}

type DependencyKindPrefix =
  (typeof DEPENDENCY_KIND_PREFIX)[keyof typeof DEPENDENCY_KIND_PREFIX];

function identifyDependency(
  kind: DependencyKind,
  schema: string,
  name: string,
  identity_arguments: string | null,
): `${DependencyKindPrefix}:${string}` {
  const prefix = DEPENDENCY_KIND_PREFIX[kind];
  return `${prefix}:${schema}.${name}${identity_arguments ? `(${identity_arguments})` : ""}`;
}
