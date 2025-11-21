import { describe, expect, test } from "vitest";
import { DefaultPrivilegeState } from "../base.default-privileges.ts";
import { diffAggregates } from "./aggregate.diff.ts";
import { Aggregate } from "./aggregate.model.ts";
import { AlterAggregateChangeOwner } from "./changes/aggregate.alter.ts";
import {
  CreateCommentOnAggregate,
  DropCommentOnAggregate,
} from "./changes/aggregate.comment.ts";
import { CreateAggregate } from "./changes/aggregate.create.ts";
import { DropAggregate } from "./changes/aggregate.drop.ts";
import {
  GrantAggregatePrivileges,
  RevokeAggregatePrivileges,
  RevokeGrantOptionAggregatePrivileges,
} from "./changes/aggregate.privilege.ts";

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
    privileges: override.privileges ?? [...base.privileges],
  });

const testContext = {
  version: 170000,
  currentUser: "postgres",
  defaultPrivilegeState: new DefaultPrivilegeState({}),
  mainRoles: {},
};

describe.concurrent("aggregate.diff", () => {
  test("create and drop emit expected changes", () => {
    const aggregate = makeAggregate({ comment: "sum comment" });
    const created = diffAggregates(
      testContext,
      {},
      { [aggregate.stableId]: aggregate },
    );

    expect(created[0]).toBeInstanceOf(CreateAggregate);
    expect(
      created.some((change) => change instanceof CreateCommentOnAggregate),
    ).toBe(true);

    const dropped = diffAggregates(
      testContext,
      { [aggregate.stableId]: aggregate },
      {},
    );

    expect(dropped[0]).toBeInstanceOf(DropAggregate);
  });

  test("alter owner produces change owner statement", () => {
    const main = makeAggregate();
    const branch = makeAggregate({ owner: "owner2" });
    const changes = diffAggregates(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );

    expect(changes).toHaveLength(1);
    expect(changes[0]).toBeInstanceOf(AlterAggregateChangeOwner);
  });

  test("comment changes emit create/drop comment statements", () => {
    const main = makeAggregate();
    const withComment = makeAggregate({ comment: "sum comment" });
    const addComment = diffAggregates(
      testContext,
      { [main.stableId]: main },
      { [withComment.stableId]: withComment },
    );

    expect(addComment[0]).toBeInstanceOf(CreateCommentOnAggregate);

    const dropComment = diffAggregates(
      testContext,
      { [withComment.stableId]: withComment },
      { [main.stableId]: main },
    );

    expect(dropComment[0]).toBeInstanceOf(DropCommentOnAggregate);
  });

  test("non-alterable changes force create or replace", () => {
    const main = makeAggregate();
    const branch = makeAggregate({ return_type: "text" });
    const changes = diffAggregates(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );

    expect(changes).toHaveLength(1);
    expect(changes[0]).toBeInstanceOf(CreateAggregate);
    expect((changes[0] as CreateAggregate).orReplace).toBe(true);
  });

  test("privilege diffs emit grant, revoke, and revoke grant option statements", () => {
    const main = makeAggregate({
      privileges: [
        { grantee: "role_exec", privilege: "EXECUTE", grantable: false },
        { grantee: "role_with_option", privilege: "EXECUTE", grantable: true },
        { grantee: "role_removed", privilege: "EXECUTE", grantable: false },
      ],
    });
    const branch = makeAggregate({
      privileges: [
        { grantee: "role_exec", privilege: "EXECUTE", grantable: true },
        { grantee: "role_with_option", privilege: "EXECUTE", grantable: false },
        { grantee: "role_new", privilege: "EXECUTE", grantable: false },
      ],
    });

    const changes = diffAggregates(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );

    expect(
      changes.some((change) => change instanceof GrantAggregatePrivileges),
    ).toBe(true);
    expect(
      changes.some((change) => change instanceof RevokeAggregatePrivileges),
    ).toBe(true);
    expect(
      changes.some(
        (change) => change instanceof RevokeGrantOptionAggregatePrivileges,
      ),
    ).toBe(true);

    const grantBase = changes.find(
      (change) =>
        change instanceof GrantAggregatePrivileges &&
        change.grantee === "role_with_option",
    ) as GrantAggregatePrivileges | undefined;
    expect(grantBase?.privileges).toEqual([
      {
        grantee: "role_with_option",
        privilege: "EXECUTE",
        grantable: false,
      },
    ]);

    const revokeGrantOption = changes.find(
      (change) =>
        change instanceof RevokeGrantOptionAggregatePrivileges &&
        change.grantee === "role_with_option",
    ) as RevokeGrantOptionAggregatePrivileges | undefined;
    expect(revokeGrantOption?.privilegeNames).toEqual(["EXECUTE"]);

    const revokePrivilege = changes.find(
      (change) =>
        change instanceof RevokeAggregatePrivileges &&
        change.grantee === "role_removed",
    ) as RevokeAggregatePrivileges | undefined;
    expect(revokePrivilege?.privileges).toEqual([
      { grantee: "role_removed", privilege: "EXECUTE", grantable: false },
    ]);
  });
});
