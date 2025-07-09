import type { Sql } from "postgres";
import type { DependentDatabaseObject } from "../types.ts";

// PostgreSQL constraint types
export type ConstraintType =
  /** CHECK */
  | "c"
  /** FOREIGN KEY */
  | "f"
  /** PRIMARY KEY */
  | "p"
  /** UNIQUE */
  | "u"
  /** EXCLUDE */
  | "x";
// c = CHECK, f = FOREIGN KEY, p = PRIMARY KEY, u = UNIQUE, x = EXCLUDE

// PostgreSQL foreign key actions
export type ForeignKeyAction =
  /** NO ACTION */
  | "a"
  /** RESTRICT */
  | "r"
  /** CASCADE */
  | "c"
  /** SET NULL */
  | "n"
  /** SET DEFAULT */
  | "d";
// a = NO ACTION, r = RESTRICT, c = CASCADE, n = SET NULL, d = SET DEFAULT

// PostgreSQL foreign key match types
export type ForeignKeyMatchType =
  /** FULL */
  | "f"
  /** PARTIAL */
  | "p"
  /** SIMPLE */
  | "s";
// f = FULL, p = PARTIAL, s = SIMPLE

export interface InspectedConstraintRow {
  schema: string;
  name: string;
  table_schema: string;
  table_name: string;
  constraint_type: ConstraintType;
  deferrable: boolean;
  initially_deferred: boolean;
  validated: boolean;
  is_local: boolean;
  no_inherit: boolean;
  key_columns: number[];
  foreign_key_columns: number[] | null;
  foreign_key_table: string | null;
  foreign_key_schema: string | null;
  on_update: ForeignKeyAction | null;
  on_delete: ForeignKeyAction | null;
  match_type: ForeignKeyMatchType | null;
  check_expression: string | null;
  owner: string;
}

export type InspectedConstraint = InspectedConstraintRow &
  DependentDatabaseObject;

export function identifyConstraint(constraint: InspectedConstraintRow): string {
  return `${constraint.schema}.${constraint.table_name}.${constraint.name}`;
}

export async function inspectConstraints(
  sql: Sql,
): Promise<Map<string, InspectedConstraint>> {
  const constraints = await sql<InspectedConstraintRow[]>`
with extension_oids as (
  select
    objid
  from
    pg_depend d
  where
    d.refclassid = 'pg_extension'::regclass
    and d.classid = 'pg_constraint'::regclass
)
select
  n.nspname as schema,
  c.conname as name,
  tn.nspname as table_schema,
  tc.relname as table_name,
  c.contype as constraint_type,
  c.condeferrable as deferrable,
  c.condeferred as initially_deferred,
  c.convalidated as validated,
  c.conislocal as is_local,
  c.connoinherit as no_inherit,
  c.conkey as key_columns,
  c.confkey as foreign_key_columns,
  ftn.nspname as foreign_key_schema,
  ftc.relname as foreign_key_table,
  c.confupdtype as on_update,
  c.confdeltype as on_delete,
  c.confmatchtype as match_type,
  pg_get_expr(c.conbin, c.conrelid) as check_expression,
  pg_get_userbyid(tc.relowner) as owner
from
  pg_catalog.pg_constraint c
  inner join pg_catalog.pg_class tc on tc.oid = c.conrelid
  inner join pg_catalog.pg_namespace tn on tn.oid = tc.relnamespace
  inner join pg_catalog.pg_namespace n on n.oid = c.connamespace
  left join pg_catalog.pg_class ftc on ftc.oid = c.confrelid
  left join pg_catalog.pg_namespace ftn on ftn.oid = ftc.relnamespace
  left outer join extension_oids e on c.oid = e.objid
  -- <EXCLUDE_INTERNAL>
  where n.nspname not in ('pg_internal', 'pg_catalog', 'information_schema', 'pg_toast')
  and n.nspname not like 'pg\_temp\_%' and n.nspname not like 'pg\_toast\_temp\_%'
  and e.objid is null
  -- </EXCLUDE_INTERNAL>
order by
  1, 2;
  `;

  return new Map(
    constraints.map((c) => [
      identifyConstraint(c),
      {
        ...c,
        dependent_on: [],
        dependents: [],
      },
    ]),
  );
}
