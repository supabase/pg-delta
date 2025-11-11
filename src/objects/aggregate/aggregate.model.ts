import type { Sql } from "postgres";
import z from "zod";
import { BasePgModel } from "../base.model.ts";
import {
  type PrivilegeProps,
  privilegePropsSchema,
} from "../base.privilege-diff.ts";

const AggregateKindSchema = z.enum([
  "n", // normal aggregate
  "o", // ordered-set aggregate
  "h", // hypothetical-set aggregate
]);

const FunctionParallelSafetySchema = z.enum([
  "u", // UNSAFE
  "s", // SAFE
  "r", // RESTRICTED
]);

const FunctionArgumentModeSchema = z.enum([
  "i", // IN parameter
  "o", // OUT parameter
  "b", // INOUT parameter
  "v", // VARIADIC parameter
  "t", // TABLE parameter
]);

const FinalFunctionModifySchema = z.enum([
  "r", // READ_ONLY
  "s", // SHAREABLE
  "w", // READ_WRITE
]);

const aggregatePropsSchema = z.object({
  schema: z.string(),
  name: z.string(),
  identity_arguments: z.string(),
  kind: z.literal("a"),
  aggkind: AggregateKindSchema,
  num_direct_args: z.number(),
  return_type: z.string(),
  return_type_schema: z.string().nullable(),
  parallel_safety: FunctionParallelSafetySchema,
  is_strict: z.boolean(),
  transition_function: z.string(),
  state_data_type: z.string(),
  state_data_type_schema: z.string().nullable(),
  state_data_space: z.number(),
  final_function: z.string().nullable(),
  final_function_extra_args: z.boolean(),
  final_function_modify: FinalFunctionModifySchema.nullable(),
  combine_function: z.string().nullable(),
  serial_function: z.string().nullable(),
  deserial_function: z.string().nullable(),
  initial_condition: z.string().nullable(),
  moving_transition_function: z.string().nullable(),
  moving_inverse_function: z.string().nullable(),
  moving_state_data_type: z.string().nullable(),
  moving_state_data_type_schema: z.string().nullable(),
  moving_state_data_space: z.number().nullable(),
  moving_final_function: z.string().nullable(),
  moving_final_function_extra_args: z.boolean(),
  moving_final_function_modify: FinalFunctionModifySchema.nullable(),
  moving_initial_condition: z.string().nullable(),
  sort_operator: z.string().nullable(),
  argument_count: z.number(),
  argument_default_count: z.number(),
  argument_names: z.array(z.string()).nullable(),
  argument_types: z.array(z.string()).nullable(),
  all_argument_types: z.array(z.string()).nullable(),
  argument_modes: z.array(FunctionArgumentModeSchema).nullable(),
  argument_defaults: z.string().nullable(),
  owner: z.string(),
  comment: z.string().nullable(),
  privileges: z.array(privilegePropsSchema),
});

type AggregatePrivilegeProps = PrivilegeProps;
type AggregateProps = z.infer<typeof aggregatePropsSchema>;

export class Aggregate extends BasePgModel {
  public readonly schema: AggregateProps["schema"];
  public readonly name: AggregateProps["name"];
  public readonly identityArguments: AggregateProps["identity_arguments"];
  public readonly kind: AggregateProps["kind"];
  public readonly aggkind: AggregateProps["aggkind"];
  public readonly num_direct_args: AggregateProps["num_direct_args"];
  public readonly return_type: AggregateProps["return_type"];
  public readonly return_type_schema: AggregateProps["return_type_schema"];
  public readonly parallel_safety: AggregateProps["parallel_safety"];
  public readonly is_strict: AggregateProps["is_strict"];
  public readonly transition_function: AggregateProps["transition_function"];
  public readonly state_data_type: AggregateProps["state_data_type"];
  public readonly state_data_type_schema: AggregateProps["state_data_type_schema"];
  public readonly state_data_space: AggregateProps["state_data_space"];
  public readonly final_function: AggregateProps["final_function"];
  public readonly final_function_extra_args: AggregateProps["final_function_extra_args"];
  public readonly final_function_modify: AggregateProps["final_function_modify"];
  public readonly combine_function: AggregateProps["combine_function"];
  public readonly serial_function: AggregateProps["serial_function"];
  public readonly deserial_function: AggregateProps["deserial_function"];
  public readonly initial_condition: AggregateProps["initial_condition"];
  public readonly moving_transition_function: AggregateProps["moving_transition_function"];
  public readonly moving_inverse_function: AggregateProps["moving_inverse_function"];
  public readonly moving_state_data_type: AggregateProps["moving_state_data_type"];
  public readonly moving_state_data_type_schema: AggregateProps["moving_state_data_type_schema"];
  public readonly moving_state_data_space: AggregateProps["moving_state_data_space"];
  public readonly moving_final_function: AggregateProps["moving_final_function"];
  public readonly moving_final_function_extra_args: AggregateProps["moving_final_function_extra_args"];
  public readonly moving_final_function_modify: AggregateProps["moving_final_function_modify"];
  public readonly moving_initial_condition: AggregateProps["moving_initial_condition"];
  public readonly sort_operator: AggregateProps["sort_operator"];
  public readonly argument_count: AggregateProps["argument_count"];
  public readonly argument_default_count: AggregateProps["argument_default_count"];
  public readonly argument_names: AggregateProps["argument_names"];
  public readonly argument_types: AggregateProps["argument_types"];
  public readonly all_argument_types: AggregateProps["all_argument_types"];
  public readonly argument_modes: AggregateProps["argument_modes"];
  public readonly argument_defaults: AggregateProps["argument_defaults"];
  public readonly owner: AggregateProps["owner"];
  public readonly comment: AggregateProps["comment"];
  public readonly privileges: AggregatePrivilegeProps[];

  constructor(props: AggregateProps) {
    super();

    this.schema = props.schema;
    this.name = props.name;
    this.identityArguments = props.identity_arguments.trim();
    this.kind = props.kind;
    this.aggkind = props.aggkind;
    this.num_direct_args = props.num_direct_args;
    this.return_type = props.return_type;
    this.return_type_schema = props.return_type_schema;
    this.parallel_safety = props.parallel_safety;
    this.is_strict = props.is_strict;
    this.transition_function = props.transition_function;
    this.state_data_type = props.state_data_type;
    this.state_data_type_schema = props.state_data_type_schema;
    this.state_data_space = props.state_data_space;
    this.final_function = props.final_function;
    this.final_function_extra_args = props.final_function_extra_args;
    this.final_function_modify = props.final_function_modify;
    this.combine_function = props.combine_function;
    this.serial_function = props.serial_function;
    this.deserial_function = props.deserial_function;
    this.initial_condition = props.initial_condition;
    this.moving_transition_function = props.moving_transition_function;
    this.moving_inverse_function = props.moving_inverse_function;
    this.moving_state_data_type = props.moving_state_data_type;
    this.moving_state_data_type_schema = props.moving_state_data_type_schema;
    this.moving_state_data_space = props.moving_state_data_space;
    this.moving_final_function = props.moving_final_function;
    this.moving_final_function_extra_args =
      props.moving_final_function_extra_args;
    this.moving_final_function_modify = props.moving_final_function_modify;
    this.moving_initial_condition = props.moving_initial_condition;
    this.sort_operator = props.sort_operator;
    this.argument_count = props.argument_count;
    this.argument_default_count = props.argument_default_count;
    this.argument_names = props.argument_names;
    this.argument_types = props.argument_types;
    this.all_argument_types = props.all_argument_types;
    this.argument_modes = props.argument_modes;
    this.argument_defaults = props.argument_defaults;
    this.owner = props.owner;
    this.comment = props.comment;
    this.privileges = props.privileges;
  }

  get stableId(): `aggregate:${string}` {
    const normalized = this.identityArguments;
    return `aggregate:${this.schema}.${this.name}(${normalized})`;
  }

  get identityFields() {
    return {
      schema: this.schema,
      name: this.name,
      identity_arguments: this.identityArguments,
    };
  }

  get dataFields() {
    return {
      kind: this.kind,
      aggkind: this.aggkind,
      num_direct_args: this.num_direct_args,
      return_type: this.return_type,
      return_type_schema: this.return_type_schema,
      parallel_safety: this.parallel_safety,
      is_strict: this.is_strict,
      transition_function: this.transition_function,
      state_data_type: this.state_data_type,
      state_data_type_schema: this.state_data_type_schema,
      state_data_space: this.state_data_space,
      final_function: this.final_function,
      final_function_extra_args: this.final_function_extra_args,
      final_function_modify: this.final_function_modify,
      combine_function: this.combine_function,
      serial_function: this.serial_function,
      deserial_function: this.deserial_function,
      initial_condition: this.initial_condition,
      moving_transition_function: this.moving_transition_function,
      moving_inverse_function: this.moving_inverse_function,
      moving_state_data_type: this.moving_state_data_type,
      moving_state_data_type_schema: this.moving_state_data_type_schema,
      moving_state_data_space: this.moving_state_data_space,
      moving_final_function: this.moving_final_function,
      moving_final_function_extra_args: this.moving_final_function_extra_args,
      moving_final_function_modify: this.moving_final_function_modify,
      moving_initial_condition: this.moving_initial_condition,
      sort_operator: this.sort_operator,
      argument_count: this.argument_count,
      argument_default_count: this.argument_default_count,
      argument_names: this.argument_names,
      argument_types: this.argument_types,
      all_argument_types: this.all_argument_types,
      argument_modes: this.argument_modes,
      argument_defaults: this.argument_defaults,
      identity_arguments: this.identityArguments,
      owner: this.owner,
      comment: this.comment,
      privileges: this.privileges,
    };
  }
}

export async function extractAggregates(sql: Sql): Promise<Aggregate[]> {
  return sql.begin(async (sql) => {
    await sql`set search_path = ''`;
    const aggregateRows = await sql`
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
  pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
  p.prokind as kind,
  a.aggkind,
  a.aggnumdirectargs as num_direct_args,
  format_type(p.prorettype, null) as return_type,
  rt.typnamespace::regnamespace::text as return_type_schema,
  p.proparallel as parallel_safety,
  p.proisstrict as is_strict,
  a.aggtransfn::regprocedure::text as transition_function,
  format_type(a.aggtranstype, null) as state_data_type,
  st.typnamespace::regnamespace::text as state_data_type_schema,
  a.aggtransspace as state_data_space,
  case when a.aggfinalfn = 0 then null else a.aggfinalfn::regprocedure::text end as final_function,
  a.aggfinalextra as final_function_extra_args,
  nullif(a.aggfinalmodify::text, ' ') as final_function_modify,
  case when a.aggcombinefn = 0 then null else a.aggcombinefn::regprocedure::text end as combine_function,
  case when a.aggserialfn = 0 then null else a.aggserialfn::regprocedure::text end as serial_function,
  case when a.aggdeserialfn = 0 then null else a.aggdeserialfn::regprocedure::text end as deserial_function,
  a.agginitval as initial_condition,
  case when a.aggmtransfn = 0 then null else a.aggmtransfn::regprocedure::text end as moving_transition_function,
  case when a.aggminvtransfn = 0 then null else a.aggminvtransfn::regprocedure::text end as moving_inverse_function,
  case when a.aggmtranstype = 0 then null else format_type(a.aggmtranstype, null) end as moving_state_data_type,
  case when a.aggmtranstype = 0 then null else mt.typnamespace::regnamespace::text end as moving_state_data_type_schema,
  case when a.aggmtransfn = 0 then null else a.aggmtransspace end as moving_state_data_space,
  case when a.aggmfinalfn = 0 then null else a.aggmfinalfn::regprocedure::text end as moving_final_function,
  a.aggmfinalextra as moving_final_function_extra_args,
  nullif(a.aggmfinalmodify::text, ' ') as moving_final_function_modify,
  a.aggminitval as moving_initial_condition,
  case when a.aggsortop = 0 then null else a.aggsortop::regoperator::text end as sort_operator,
  p.pronargs as argument_count,
  p.pronargdefaults as argument_default_count,
  case when p.proargnames is null then null
       else array(select quote_ident(n) from unnest(p.proargnames) as n)
  end as argument_names,
  array(select format_type(oid, null) from unnest(p.proargtypes) as oid) as argument_types,
  array(select format_type(oid, null) from unnest(p.proallargtypes) as oid) as all_argument_types,
  p.proargmodes as argument_modes,
  pg_get_expr(p.proargdefaults, 0) as argument_defaults,
  p.proowner::regrole::text as owner,
  obj_description(p.oid, 'pg_proc') as comment,
  coalesce(
    (
      select json_agg(
        json_build_object(
          'grantee', case when x.grantee = 0 then 'PUBLIC' else x.grantee::regrole::text end,
          'privilege', x.privilege_type,
          'grantable', x.is_grantable
        )
        order by x.grantee, x.privilege_type
      )
      from lateral aclexplode(p.proacl) as x(grantor, grantee, privilege_type, is_grantable)
    ), '[]'
  ) as privileges
from
  pg_catalog.pg_proc p
  inner join pg_catalog.pg_aggregate a on a.aggfnoid = p.oid
  left join pg_catalog.pg_type rt on rt.oid = p.prorettype
  left join pg_catalog.pg_type st on st.oid = a.aggtranstype
  left join pg_catalog.pg_type mt on mt.oid = a.aggmtranstype
  left outer join extension_oids e on p.oid = e.objid
where
  p.prokind = 'a'
  and not p.pronamespace::regnamespace::text like any(array['pg\\_%', 'information\\_schema'])
  and e.objid is null
order by
  1, 2, 3;
    `;

    const validatedRows = aggregateRows.map((row: unknown) =>
      aggregatePropsSchema.parse(row),
    );
    return validatedRows.map((row: AggregateProps) => new Aggregate(row));
  });
}
