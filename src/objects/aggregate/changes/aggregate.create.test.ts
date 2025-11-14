import { describe, expect, test } from "vitest";
import { Aggregate } from "../aggregate.model.ts";
import { CreateAggregate } from "./aggregate.create.ts";

type AggregateProps = ConstructorParameters<typeof Aggregate>[0];

const base: AggregateProps = {
  schema: "public",
  name: "agg_sum",
  identity_arguments: "integer",
  kind: "a",
  aggkind: "n",
  num_direct_args: 0,
  return_type: "integer",
  return_type_schema: "pg_catalog",
  parallel_safety: "u",
  is_strict: false,
  transition_function: "pg_catalog.int4pl(integer,integer)",
  state_data_type: "integer",
  state_data_type_schema: "pg_catalog",
  state_data_space: 0,
  final_function: null,
  final_function_extra_args: false,
  final_function_modify: null,
  combine_function: null,
  serial_function: null,
  deserial_function: null,
  initial_condition: null,
  moving_transition_function: null,
  moving_inverse_function: null,
  moving_state_data_type: null,
  moving_state_data_type_schema: null,
  moving_state_data_space: null,
  moving_final_function: null,
  moving_final_function_extra_args: false,
  moving_final_function_modify: null,
  moving_initial_condition: null,
  sort_operator: null,
  argument_count: 1,
  argument_default_count: 0,
  argument_names: null,
  argument_types: ["integer"],
  all_argument_types: null,
  argument_modes: null,
  argument_defaults: null,
  owner: "owner1",
  comment: null,
  privileges: [],
};

const makeAggregate = (override: Partial<AggregateProps> = {}) =>
  new Aggregate({
    ...base,
    ...override,
  });

describe("aggregate.create", () => {
  test("serialize minimal aggregate", () => {
    const aggregate = makeAggregate();
    const change = new CreateAggregate({ aggregate });

    expect(change.creates).toEqual([aggregate.stableId]);
    expect(change.serialize()).toMatchInlineSnapshot(
      `"CREATE AGGREGATE public.agg_sum(integer) (SFUNC = pg_catalog.int4pl, STYPE = integer)"`,
    );
  });

  test("serialize aggregate with optional clauses and or replace", () => {
    const aggregate = makeAggregate({
      name: "agg_full",
      transition_function: "public.sum_int8(bigint,bigint)",
      state_data_type: "bigint",
      state_data_space: 8,
      final_function: "public.finalize(bigint)",
      final_function_extra_args: true,
      final_function_modify: "w",
      combine_function: "public.combine(bigint,bigint)",
      serial_function: "public.serialize_state(internal)",
      deserial_function: "public.deserialize_state(bytea,internal)",
      initial_condition: "0",
      moving_transition_function: "public.msum(bigint,bigint)",
      moving_inverse_function: "public.minv(bigint,bigint)",
      moving_state_data_type: "pg_catalog.bigint",
      moving_state_data_space: 16,
      moving_final_function: "public.mfinal(bigint)",
      moving_final_function_extra_args: true,
      moving_final_function_modify: "s",
      moving_initial_condition: "0",
      sort_operator: "pg_catalog.<(integer,integer)",
      parallel_safety: "s",
      is_strict: true,
      aggkind: "h",
    });

    const change = new CreateAggregate({ aggregate, orReplace: true });

    expect(change.serialize()).toMatchInlineSnapshot(
      `"CREATE OR REPLACE AGGREGATE public.agg_full(integer) (SFUNC = public.sum_int8, STYPE = bigint, SSPACE = 8, FINALFUNC = public.finalize, FINALFUNC_EXTRA, FINALFUNC_MODIFY = READ_WRITE, COMBINEFUNC = public.combine, SERIALFUNC = public.serialize_state, DESERIALFUNC = public.deserialize_state, INITCOND = '0', MSFUNC = public.msum, MINVFUNC = public.minv, MSTYPE = pg_catalog.bigint, MSSPACE = 16, MFINALFUNC = public.mfinal, MFINALFUNC_EXTRA, MFINALFUNC_MODIFY = SHAREABLE, MINITCOND = '0', SORTOP = OPERATOR(pg_catalog.<), PARALLEL SAFE, STRICT, HYPOTHETICAL)"`,
    );
  });
});
