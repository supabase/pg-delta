import type { Sql } from "postgres";
import z from "zod";
import { BasePgModel } from "../base.model.ts";

const TriggerEnabledSchema = z.enum([
  "O", // ORIGIN - trigger fires in "origin" and "local" replica modes
  "D", // DISABLED - trigger is disabled
  "R", // REPLICA - trigger fires only in "replica" mode
  "A", // ALWAYS - trigger fires regardless of replication mode
]);

export type TriggerEnabled = z.infer<typeof TriggerEnabledSchema>;

const triggerPropsSchema = z.object({
  schema: z.string(),
  name: z.string(),
  table_name: z.string(),
  function_schema: z.string(),
  function_name: z.string(),
  trigger_type: z.number(),
  enabled: TriggerEnabledSchema,
  is_internal: z.boolean(),
  deferrable: z.boolean(),
  initially_deferred: z.boolean(),
  argument_count: z.number(),
  column_numbers: z.array(z.number()).nullable(),
  arguments: z.array(z.string()),
  when_condition: z.string().nullable(),
  old_table: z.string().nullable(),
  new_table: z.string().nullable(),
  owner: z.string(),
});

export type TriggerProps = z.infer<typeof triggerPropsSchema>;

export class Trigger extends BasePgModel {
  public readonly schema: TriggerProps["schema"];
  public readonly name: TriggerProps["name"];
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
    const triggerRows = await sql`
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
  tc.relnamespace::regnamespace::text as schema,
  quote_ident(t.tgname) as name,
  quote_ident(tc.relname) as table_name,
  fc.pronamespace::regnamespace::text as function_schema,
  quote_ident(fc.proname) as function_name,
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
  tc.relowner::regrole::text as owner
from
  pg_catalog.pg_trigger t
  inner join pg_catalog.pg_class tc on tc.oid = t.tgrelid
  inner join pg_catalog.pg_proc fc on fc.oid = t.tgfoid
  left outer join extension_oids e on t.oid = e.objid
  where not tc.relnamespace::regnamespace::text like any(array['pg\\_%', 'information\\_schema'])
  and e.objid is null
  and not t.tgisinternal
order by
  1, 2;
    `;
    // Validate and parse each row using the Zod schema
    const validatedRows = triggerRows.map((row: unknown) =>
      triggerPropsSchema.parse(row),
    );
    return validatedRows.map((row: TriggerProps) => new Trigger(row));
  });
}
