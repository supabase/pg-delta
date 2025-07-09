import type { Sql } from "postgres";
import type { DependentDatabaseObject } from "../types.ts";

// PostgreSQL function/procedure kinds
export type FunctionKind =
  /** function */
  | "f"
  /** procedure */
  | "p"
  /** aggregate */
  | "a"
  /** window */
  | "w";

// PostgreSQL function volatility
export type FunctionVolatility =
  /** immutable */
  | "i"
  /** stable */
  | "s"
  /** volatile */
  | "v";

// PostgreSQL function parallel safety
export type FunctionParallelSafety =
  /** unsafe */
  | "u"
  /** safe */
  | "s"
  /** restricted */
  | "r";

// PostgreSQL function argument modes
export type FunctionArgumentMode =
  /** IN */
  | "i"
  /** OUT */
  | "o"
  /** INOUT */
  | "b"
  /** VARIADIC */
  | "v"
  /** TABLE */
  | "t";

export interface InspectedFunctionRow {
  schema: string;
  name: string;
  kind: FunctionKind;
  return_type: string;
  return_type_schema: string;
  language: string;
  security_definer: boolean;
  volatility: FunctionVolatility;
  parallel_safety: FunctionParallelSafety;
  is_strict: boolean;
  leakproof: boolean;
  returns_set: boolean;
  argument_count: number;
  argument_default_count: number;
  argument_names: string[] | null;
  argument_types: string[] | null;
  all_argument_types: string[] | null;
  argument_modes: FunctionArgumentMode[] | null;
  argument_defaults: string | null;
  source_code: string | null;
  binary_path: string | null;
  sql_body: string | null;
  config: string[] | null;
  owner: string;
}

export type InspectedFunction = InspectedFunctionRow & DependentDatabaseObject;

export async function inspectFunctions(
  sql: Sql,
): Promise<Map<string, InspectedFunction>> {
  const functions = await sql<InspectedFunctionRow[]>`
with extension_oids as (
  select
    objid
  from
    pg_depend d
  where
    d.refclassid = 'pg_extension'::regclass
    and d.classid = 'pg_proc'::regclass
)
select
  n.nspname as schema,
  p.proname as name,
  p.prokind as kind,
  rt.typname as return_type,
  rn.nspname as return_type_schema,
  l.lanname as language,
  p.prosecdef as security_definer,
  p.provolatile as volatility,
  p.proparallel as parallel_safety,
  p.proisstrict as is_strict,
  p.proleakproof as leakproof,
  p.proretset as returns_set,
  p.pronargs as argument_count,
  p.pronargdefaults as argument_default_count,
  p.proargnames as argument_names,
  array(
    select format_type(oid, null)
    from unnest(p.proargtypes) as oid
  ) as argument_types,
  array(
    select format_type(oid, null)
    from unnest(p.proallargtypes) as oid
  ) as all_argument_types,
  p.proargmodes as argument_modes,
  pg_get_expr(p.proargdefaults, 0) as argument_defaults,
  p.prosrc as source_code,
  p.probin as binary_path,
  pg_get_expr(p.prosqlbody, 0) as sql_body,
  p.proconfig as config,
  pg_get_userbyid(p.proowner) as owner
from
  pg_catalog.pg_proc p
  inner join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  inner join pg_catalog.pg_language l on l.oid = p.prolang
  left join pg_catalog.pg_type rt on rt.oid = p.prorettype
  left join pg_catalog.pg_namespace rn on rn.oid = rt.typnamespace
  left outer join extension_oids e on p.oid = e.objid
  -- <EXCLUDE_INTERNAL>
  where n.nspname not in ('pg_internal', 'pg_catalog', 'information_schema', 'pg_toast')
  and n.nspname not like 'pg\_temp\_%' and n.nspname not like 'pg\_toast\_temp\_%'
  and e.objid is null
  and l.lanname not in ('c', 'internal')
  -- </EXCLUDE_INTERNAL>
order by
  1, 2;
  `;

  return new Map(
    functions.map((f) => [
      identifyFunction(f),
      {
        ...f,
        dependent_on: [],
        dependents: [],
      },
    ]),
  );
}

export function identifyFunction(
  function_: Pick<
    InspectedFunctionRow,
    "schema" | "name" | "argument_names" | "argument_types"
  >,
): string {
  const argNames = function_.argument_names ?? [];
  const argTypes = function_.argument_types ?? [];
  const args = argTypes
    .map((type, i) => {
      const name = argNames[i] ?? "";
      return name ? `${name} ${type}` : type;
    })
    .join(", ");
  return `${function_.schema}.${function_.name}(${args})`;
}
