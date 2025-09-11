import type { Sql } from "postgres";
import z from "zod";
import { BasePgModel } from "../base.model.ts";

const FunctionKindSchema = z.enum([
  "f", // function
  "p", // procedure
  "a", // aggregate function
  "w", // window function
]);

const FunctionVolatilitySchema = z.enum([
  "i", // IMMUTABLE
  "s", // STABLE
  "v", // VOLATILE
]);

const FunctionParallelSafetySchema = z.enum([
  "u", // UNSAFE (cannot run in parallel)
  "s", // SAFE (can run in parallel)
  "r", // RESTRICTED (can run in parallel with restrictions)
]);

const FunctionArgumentModeSchema = z.enum([
  "i", // IN parameter
  "o", // OUT parameter
  "b", // INOUT parameter
  "v", // VARIADIC parameter
  "t", // TABLE parameter
]);

const procedurePropsSchema = z.object({
  schema: z.string(),
  name: z.string(),
  kind: FunctionKindSchema,
  return_type: z.string(),
  return_type_schema: z.string(),
  language: z.string(),
  security_definer: z.boolean(),
  volatility: FunctionVolatilitySchema,
  parallel_safety: FunctionParallelSafetySchema,
  execution_cost: z.number(),
  result_rows: z.number(),
  is_strict: z.boolean(),
  leakproof: z.boolean(),
  returns_set: z.boolean(),
  argument_count: z.number(),
  argument_default_count: z.number(),
  argument_names: z.array(z.string()).nullable(),
  argument_types: z.array(z.string()).nullable(),
  all_argument_types: z.array(z.string()).nullable(),
  argument_modes: z.array(FunctionArgumentModeSchema).nullable(),
  argument_defaults: z.string().nullable(),
  source_code: z.string().nullable(),
  binary_path: z.string().nullable(),
  sql_body: z.string().nullable(),
  definition: z.string(),
  config: z.array(z.string()).nullable(),
  owner: z.string(),
});

export type ProcedureProps = z.infer<typeof procedurePropsSchema>;

export class Procedure extends BasePgModel {
  public readonly schema: ProcedureProps["schema"];
  public readonly name: ProcedureProps["name"];
  public readonly kind: ProcedureProps["kind"];
  public readonly return_type: ProcedureProps["return_type"];
  public readonly return_type_schema: ProcedureProps["return_type_schema"];
  public readonly language: ProcedureProps["language"];
  public readonly security_definer: ProcedureProps["security_definer"];
  public readonly volatility: ProcedureProps["volatility"];
  public readonly parallel_safety: ProcedureProps["parallel_safety"];
  public readonly execution_cost: ProcedureProps["execution_cost"];
  public readonly result_rows: ProcedureProps["result_rows"];
  public readonly is_strict: ProcedureProps["is_strict"];
  public readonly leakproof: ProcedureProps["leakproof"];
  public readonly returns_set: ProcedureProps["returns_set"];
  public readonly argument_count: ProcedureProps["argument_count"];
  public readonly argument_default_count: ProcedureProps["argument_default_count"];
  public readonly argument_names: ProcedureProps["argument_names"];
  public readonly argument_types: ProcedureProps["argument_types"];
  public readonly all_argument_types: ProcedureProps["all_argument_types"];
  public readonly argument_modes: ProcedureProps["argument_modes"];
  public readonly argument_defaults: ProcedureProps["argument_defaults"];
  public readonly source_code: ProcedureProps["source_code"];
  public readonly binary_path: ProcedureProps["binary_path"];
  public readonly sql_body: ProcedureProps["sql_body"];
  public readonly definition: ProcedureProps["definition"];
  public readonly config: ProcedureProps["config"];
  public readonly owner: ProcedureProps["owner"];

  constructor(props: ProcedureProps) {
    super();

    // Identity fields
    this.schema = props.schema;
    this.name = props.name;

    // Data fields
    this.kind = props.kind;
    this.return_type = props.return_type;
    this.return_type_schema = props.return_type_schema;
    this.language = props.language;
    this.security_definer = props.security_definer;
    this.volatility = props.volatility;
    this.parallel_safety = props.parallel_safety;
    this.execution_cost = props.execution_cost;
    this.result_rows = props.result_rows;
    this.is_strict = props.is_strict;
    this.leakproof = props.leakproof;
    this.returns_set = props.returns_set;
    this.argument_count = props.argument_count;
    this.argument_default_count = props.argument_default_count;
    this.argument_names = props.argument_names;
    this.argument_types = props.argument_types;
    this.all_argument_types = props.all_argument_types;
    this.argument_modes = props.argument_modes;
    this.argument_defaults = props.argument_defaults;
    this.source_code = props.source_code;
    this.binary_path = props.binary_path;
    this.sql_body = props.sql_body;
    this.definition = props.definition;
    this.config = props.config;
    this.owner = props.owner;
  }

  get stableId(): `procedure:${string}` {
    const args = this.argument_types?.join(",") ?? "";
    return `procedure:${this.schema}.${this.name}(${args})`;
  }

  get identityFields() {
    return {
      schema: this.schema,
      name: this.name,
    };
  }

  get dataFields() {
    return {
      kind: this.kind,
      return_type: this.return_type,
      return_type_schema: this.return_type_schema,
      language: this.language,
      security_definer: this.security_definer,
      volatility: this.volatility,
      parallel_safety: this.parallel_safety,
      // execution_cost and result_rows are planner hints. We intentionally
      // exclude them from dataFields to avoid generating diffs solely due to
      // changes in estimates. They are still used for CREATE serialization.
      is_strict: this.is_strict,
      leakproof: this.leakproof,
      returns_set: this.returns_set,
      argument_count: this.argument_count,
      argument_default_count: this.argument_default_count,
      argument_names: this.argument_names,
      argument_types: this.argument_types,
      all_argument_types: this.all_argument_types,
      argument_modes: this.argument_modes,
      argument_defaults: this.argument_defaults,
      source_code: this.source_code,
      binary_path: this.binary_path,
      sql_body: this.sql_body,
      definition: this.definition,
      config: this.config,
      owner: this.owner,
    };
  }
}

export async function extractProcedures(sql: Sql): Promise<Procedure[]> {
  return sql.begin(async (sql) => {
    await sql`set search_path = ''`;
    const procedureRows = await sql`
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
  p.pronamespace::regnamespace::text as schema,
  quote_ident(p.proname) as name,
  p.prokind as kind,
  format_type(p.prorettype, null) as return_type,
  rt.typnamespace::regnamespace::text as return_type_schema,
  l.lanname as language,
  p.prosecdef as security_definer,
  p.provolatile as volatility,
  p.proparallel as parallel_safety,
  p.procost as execution_cost,
  p.prorows as result_rows,
  p.proisstrict as is_strict,
  p.proleakproof as leakproof,
  p.proretset as returns_set,
  p.pronargs as argument_count,
  p.pronargdefaults as argument_default_count,
  -- quote argument names server-side for safe serialization
  case when p.proargnames is null then null
       else array(select quote_ident(n) from unnest(p.proargnames) as n)
  end as argument_names,
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
  pg_get_function_sqlbody(p.oid) as sql_body,
  pg_get_functiondef(p.oid) as definition,
  p.proconfig as config,
  p.proowner::regrole::text as owner
from
  pg_catalog.pg_proc p
  inner join pg_catalog.pg_language l on l.oid = p.prolang
  left join pg_catalog.pg_type rt on rt.oid = p.prorettype
  left outer join extension_oids e on p.oid = e.objid
  where not p.pronamespace::regnamespace::text like any(array['pg\\_%', 'information\\_schema'])
  and e.objid is null
  and l.lanname not in ('c', 'internal')
order by
  1, 2;
    `;
    // Validate and parse each row using the Zod schema
    const validatedRows = procedureRows.map((row: unknown) =>
      procedurePropsSchema.parse(row),
    );
    return validatedRows.map((row: ProcedureProps) => new Procedure(row));
  });
}
