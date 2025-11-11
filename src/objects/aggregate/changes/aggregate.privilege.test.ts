import { describe, expect, test } from "vitest";
import { stableId } from "../../utils.ts";
import { Aggregate } from "../aggregate.model.ts";
import {
  GrantAggregatePrivileges,
  RevokeAggregatePrivileges,
  RevokeGrantOptionAggregatePrivileges,
} from "./aggregate.privilege.ts";

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

describe("aggregate.privilege", () => {
  test("grant privileges without grant option", () => {
    const aggregate = new Aggregate(base);
    const change = new GrantAggregatePrivileges({
      aggregate,
      grantee: "role_exec",
      privileges: [{ privilege: "EXECUTE", grantable: false }],
      version: 170000,
    });

    expect(change.creates).toEqual([
      stableId.acl(aggregate.stableId, "role_exec"),
    ]);
    expect(change.requires).toEqual([
      aggregate.stableId,
      stableId.role("role_exec"),
    ]);
    expect(change.serialize()).toBe(
      "GRANT ALL ON FUNCTION public.agg_sum(integer) TO role_exec",
    );
  });

  test("grant privileges with grant option", () => {
    const aggregate = new Aggregate(base);
    const change = new GrantAggregatePrivileges({
      aggregate,
      grantee: "role_exec",
      privileges: [{ privilege: "EXECUTE", grantable: true }],
    });

    expect(change.serialize()).toBe(
      "GRANT ALL ON FUNCTION public.agg_sum(integer) TO role_exec WITH GRANT OPTION",
    );
  });

  test("revoke privileges and grant option", () => {
    const aggregate = new Aggregate(base);
    const revoke = new RevokeAggregatePrivileges({
      aggregate,
      grantee: "role_old",
      privileges: [{ privilege: "EXECUTE", grantable: false }],
      version: 170000,
    });

    expect(revoke.drops).toEqual([
      stableId.acl(aggregate.stableId, "role_old"),
    ]);
    expect(revoke.requires).toEqual([
      stableId.acl(aggregate.stableId, "role_old"),
      aggregate.stableId,
      stableId.role("role_old"),
    ]);
    expect(revoke.serialize()).toBe(
      "REVOKE ALL ON FUNCTION public.agg_sum(integer) FROM role_old",
    );

    const revokeGrantOption = new RevokeGrantOptionAggregatePrivileges({
      aggregate,
      grantee: "role_with_option",
      // testing deduplication of privilege names
      privilegeNames: ["EXECUTE", "EXECUTE"],
      version: 170000,
    });

    expect(revokeGrantOption.privilegeNames).toEqual(["EXECUTE"]);
    expect(revokeGrantOption.requires).toEqual([
      stableId.acl(aggregate.stableId, "role_with_option"),
      aggregate.stableId,
      stableId.role("role_with_option"),
    ]);
    expect(revokeGrantOption.serialize()).toBe(
      "REVOKE GRANT OPTION FOR ALL ON FUNCTION public.agg_sum(integer) FROM role_with_option",
    );
  });
});
