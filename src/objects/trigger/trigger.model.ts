import type { Sql } from "postgres";
import { BasePgModel } from "../base.model.ts";

type TriggerEnabled = "O" | "D" | "R" | "A";

export interface TriggerProps {
  schema: string;
  name: string;
  table_schema: string;
  table_name: string;
  function_schema: string;
  function_name: string;
  trigger_type: number;
  enabled: TriggerEnabled;
  is_internal: boolean;
  deferrable: boolean;
  initially_deferred: boolean;
  argument_count: number;
  column_numbers: number[] | null;
  arguments: string[];
  when_condition: string | null;
  old_table: string | null;
  new_table: string | null;
  owner: string;
}

export class Trigger extends BasePgModel {
  public readonly schema: TriggerProps["schema"];
  public readonly name: TriggerProps["name"];
  public readonly table_schema: TriggerProps["table_schema"];
  public readonly table_name: TriggerProps["table_name"];
  public readonly function_schema: TriggerProps["function_schema"];
  public readonly function_name: TriggerProps["function_name"];
  public readonly trigger_type: TriggerProps["trigger_type"];
  public readonly enabled: TriggerProps["enabled"];
  public readonly is_internal: TriggerProps["is_internal"];
  public readonly deferrable: TriggerProps["deferrable"];
  public readonly initially_deferred: TriggerProps["initially_deferred"];
  public readonly argument_count: TriggerProps["argument_count"];
  public readonly column_numbers: TriggerProps["column_numbers"];
  public readonly arguments: TriggerProps["arguments"];
  public readonly when_condition: TriggerProps["when_condition"];
  public readonly old_table: TriggerProps["old_table"];
  public readonly new_table: TriggerProps["new_table"];
  public readonly owner: TriggerProps["owner"];

  constructor(props: TriggerProps) {
    super();

    // Identity fields
    this.schema = props.schema;
    this.name = props.name;
    this.table_schema = props.table_schema;
    this.table_name = props.table_name;

    // Data fields
    this.function_schema = props.function_schema;
    this.function_name = props.function_name;
    this.trigger_type = props.trigger_type;
    this.enabled = props.enabled;
    this.is_internal = props.is_internal;
    this.deferrable = props.deferrable;
    this.initially_deferred = props.initially_deferred;
    this.argument_count = props.argument_count;
    this.column_numbers = props.column_numbers;
    this.arguments = props.arguments;
    this.when_condition = props.when_condition;
    this.old_table = props.old_table;
    this.new_table = props.new_table;
    this.owner = props.owner;
  }

  get stableId(): `trigger:${string}` {
    return `trigger:${this.schema}.${this.table_name}.${this.name}`;
  }

  get identityFields() {
    return {
      schema: this.schema,
      name: this.name,
      table_schema: this.table_schema,
      table_name: this.table_name,
    };
  }

  get dataFields() {
    return {
      function_schema: this.function_schema,
      function_name: this.function_name,
      trigger_type: this.trigger_type,
      enabled: this.enabled,
      is_internal: this.is_internal,
      deferrable: this.deferrable,
      initially_deferred: this.initially_deferred,
      argument_count: this.argument_count,
      column_numbers: this.column_numbers,
      arguments: this.arguments,
      when_condition: this.when_condition,
      old_table: this.old_table,
      new_table: this.new_table,
      owner: this.owner,
    };
  }
}

export async function extractTriggers(sql: Sql): Promise<Trigger[]> {
  return sql.begin(async (sql) => {
    await sql`set search_path = ''`;
    const triggerRows = await sql<TriggerProps[]>`
with extension_oids as (
  select
    objid
  from
    pg_depend d
  where
    d.refclassid = 'pg_extension'::regclass
    and d.classid = 'pg_trigger'::regclass
)
select
  tn.nspname as schema,
  t.tgname as name,
  tn.nspname as table_schema,
  tc.relname as table_name,
  fn.nspname as function_schema,
  fc.proname as function_name,
  t.tgtype as trigger_type,
  t.tgenabled as enabled,
  t.tgisinternal as is_internal,
  t.tgdeferrable as deferrable,
  t.tginitdeferred as initially_deferred,
  t.tgnargs as argument_count,
  t.tgattr as column_numbers,
  case when t.tgnargs > 0 then array_fill(''::text, array[t.tgnargs]) else array[]::text[] end as arguments,
  pg_get_expr(t.tgqual, t.tgrelid) as when_condition,
  t.tgoldtable as old_table,
  t.tgnewtable as new_table,
  pg_get_userbyid(tc.relowner) as owner
from
  pg_catalog.pg_trigger t
  inner join pg_catalog.pg_class tc on tc.oid = t.tgrelid
  inner join pg_catalog.pg_namespace tn on tn.oid = tc.relnamespace
  inner join pg_catalog.pg_proc fc on fc.oid = t.tgfoid
  inner join pg_catalog.pg_namespace fn on fn.oid = fc.pronamespace
  left outer join extension_oids e on t.oid = e.objid
  where tn.nspname not in ('pg_internal', 'pg_catalog', 'information_schema', 'pg_toast')
  and tn.nspname not like 'pg\_temp\_%' and tn.nspname not like 'pg\_toast\_temp\_%'
  and e.objid is null
  and not t.tgisinternal
order by
  1, 2;
    `;
    return triggerRows.map((row) => new Trigger(row));
  });
}
