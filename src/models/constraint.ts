import type { Sql } from "postgres";
import { BasePgModel } from "./base.ts";

type ConstraintType = "c" | "f" | "p" | "u" | "x";
type ForeignKeyAction = "a" | "r" | "c" | "n" | "d";
type ForeignKeyMatchType = "f" | "p" | "s";

interface ConstraintProps {
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

export class Constraint extends BasePgModel {
  public readonly schema: ConstraintProps["schema"];
  public readonly name: ConstraintProps["name"];
  public readonly table_schema: ConstraintProps["table_schema"];
  public readonly table_name: ConstraintProps["table_name"];
  public readonly constraint_type: ConstraintProps["constraint_type"];
  public readonly deferrable: ConstraintProps["deferrable"];
  public readonly initially_deferred: ConstraintProps["initially_deferred"];
  public readonly validated: ConstraintProps["validated"];
  public readonly is_local: ConstraintProps["is_local"];
  public readonly no_inherit: ConstraintProps["no_inherit"];
  public readonly key_columns: ConstraintProps["key_columns"];
  public readonly foreign_key_columns: ConstraintProps["foreign_key_columns"];
  public readonly foreign_key_table: ConstraintProps["foreign_key_table"];
  public readonly foreign_key_schema: ConstraintProps["foreign_key_schema"];
  public readonly on_update: ConstraintProps["on_update"];
  public readonly on_delete: ConstraintProps["on_delete"];
  public readonly match_type: ConstraintProps["match_type"];
  public readonly check_expression: ConstraintProps["check_expression"];
  public readonly owner: ConstraintProps["owner"];

  constructor(props: ConstraintProps) {
    super();

    // Identity fields
    this.schema = props.schema;
    this.name = props.name;
    this.table_schema = props.table_schema;
    this.table_name = props.table_name;

    // Data fields
    this.constraint_type = props.constraint_type;
    this.deferrable = props.deferrable;
    this.initially_deferred = props.initially_deferred;
    this.validated = props.validated;
    this.is_local = props.is_local;
    this.no_inherit = props.no_inherit;
    this.key_columns = props.key_columns;
    this.foreign_key_columns = props.foreign_key_columns;
    this.foreign_key_table = props.foreign_key_table;
    this.foreign_key_schema = props.foreign_key_schema;
    this.on_update = props.on_update;
    this.on_delete = props.on_delete;
    this.match_type = props.match_type;
    this.check_expression = props.check_expression;
    this.owner = props.owner;
  }

  get stableId(): `constraint:${string}` {
    return `constraint:${this.schema}.${this.table_name}.${this.name}`;
  }

  get identityFields() {
    return {
      schema: this.schema,
      table_name: this.table_name,
      name: this.name,
    };
  }

  get dataFields() {
    return {
      constraint_type: this.constraint_type,
      deferrable: this.deferrable,
      initially_deferred: this.initially_deferred,
      validated: this.validated,
      is_local: this.is_local,
      no_inherit: this.no_inherit,
      key_columns: this.key_columns,
      foreign_key_columns: this.foreign_key_columns,
      foreign_key_table: this.foreign_key_table,
      foreign_key_schema: this.foreign_key_schema,
      on_update: this.on_update,
      on_delete: this.on_delete,
      match_type: this.match_type,
      check_expression: this.check_expression,
      owner: this.owner,
    };
  }
}

export async function extractConstraints(sql: Sql): Promise<Constraint[]> {
  return sql.begin(async (sql) => {
    await sql`set search_path = ''`;
    const constraintRows = await sql<ConstraintProps[]>`
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
  where n.nspname not in ('pg_internal', 'pg_catalog', 'information_schema', 'pg_toast')
  and n.nspname not like 'pg\_temp\_%' and n.nspname not like 'pg\_toast\_temp\_%'
  and e.objid is null
order by
  1, 2;
    `;
    return constraintRows.map((row) => new Constraint(row));
  });
}
