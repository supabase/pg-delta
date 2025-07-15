import type { Sql } from "postgres";

// PostgreSQL type kinds
type TypeKind =
  /** base */
  | "b"
  /** composite */
  | "c"
  /** domain */
  | "d"
  /** enum */
  | "e"
  /** pseudo */
  | "p";

// PostgreSQL type categories (see Postgres docs for full list)
type TypeCategory =
  /** array */
  | "A"
  /** boolean */
  | "B"
  /** composite */
  | "C"
  /** date/time */
  | "D"
  /** enum */
  | "E"
  /** geometric */
  | "G"
  /** network */
  | "I"
  /** numeric */
  | "N"
  /** pseudo */
  | "P"
  /** range */
  | "R"
  /** string */
  | "S"
  /** timespan */
  | "T"
  /** user-defined */
  | "U"
  /** bit-string */
  | "V"
  /** unknown */
  | "X";

// PostgreSQL type alignment
type TypeAlignment =
  /** char */
  | "c"
  /** short */
  | "s"
  /** int */
  | "i"
  /** double */
  | "d";

// PostgreSQL type storage
type TypeStorage =
  /** plain */
  | "p"
  /** external */
  | "e"
  /** main */
  | "m"
  /** extended */
  | "x";

export interface InspectedType {
  schema: string;
  name: string;
  type_type: TypeKind;
  type_category: TypeCategory;
  is_preferred: boolean;
  is_defined: boolean;
  delimiter: string;
  storage_length: number;
  passed_by_value: boolean;
  alignment: TypeAlignment;
  storage: TypeStorage;
  not_null: boolean;
  type_modifier: number | null;
  array_dimensions: number | null;
  default_bin: string | null;
  default_value: string | null;
  owner: string;
}

function identifyType(type: InspectedType): string {
  return `${type.schema}.${type.name}`;
}

export async function inspectTypes(
  sql: Sql,
): Promise<Record<string, InspectedType>> {
  const types = await sql<InspectedType[]>`
with extension_oids as (
  select
    objid
  from
    pg_depend d
  where
    d.refclassid = 'pg_extension'::regclass
    and d.classid = 'pg_type'::regclass
)
select
  n.nspname as schema,
  t.typname as name,
  t.typtype as type_type,
  t.typcategory as type_category,
  t.typispreferred as is_preferred,
  t.typisdefined as is_defined,
  t.typdelim as delimiter,
  t.typlen as storage_length,
  t.typbyval as passed_by_value,
  t.typalign as alignment,
  t.typstorage as storage,
  t.typnotnull as not_null,
  t.typtypmod as type_modifier,
  t.typndims as array_dimensions,
  pg_get_expr(t.typdefaultbin, 0) as default_bin,
  t.typdefault as default_value,
  pg_get_userbyid(t.typowner) as owner
from
  pg_catalog.pg_type t
  inner join pg_catalog.pg_namespace n on n.oid = t.typnamespace
  left outer join extension_oids e on t.oid = e.objid
  -- <EXCLUDE_INTERNAL>
  where n.nspname not in ('pg_internal', 'pg_catalog', 'information_schema', 'pg_toast')
  and n.nspname not like 'pg\_temp\_%' and n.nspname not like 'pg\_toast\_temp\_%'
  and e.objid is null
  -- </EXCLUDE_INTERNAL>
order by
  1, 2;
  `;

  return Object.fromEntries(types.map((t) => [identifyType(t), t]));
}
