import { describe, expect, test } from "vitest";
import { stableId } from "../../utils.ts";
import { Aggregate } from "../aggregate.model.ts";
import {
  CreateCommentOnAggregate,
  DropCommentOnAggregate,
} from "./aggregate.comment.ts";

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

describe("aggregate.comment", () => {
  test("create comment serializes and tracks dependencies", () => {
    const aggregate = makeAggregate({ comment: "aggregate's total" });
    const change = new CreateCommentOnAggregate({ aggregate });

    expect(change.creates).toEqual([stableId.comment(aggregate.stableId)]);
    expect(change.requires).toEqual([aggregate.stableId]);
    expect(change.serialize()).toBe(
      "COMMENT ON AGGREGATE public.agg_sum(integer) IS 'aggregate''s total'",
    );
  });

  test("drop comment serializes and tracks dependencies", () => {
    const aggregate = makeAggregate({ comment: "some comment" });
    const change = new DropCommentOnAggregate({ aggregate });

    expect(change.drops).toEqual([stableId.comment(aggregate.stableId)]);
    expect(change.requires).toEqual([
      stableId.comment(aggregate.stableId),
      aggregate.stableId,
    ]);
    expect(change.serialize()).toBe(
      "COMMENT ON AGGREGATE public.agg_sum(integer) IS NULL",
    );
  });
});
