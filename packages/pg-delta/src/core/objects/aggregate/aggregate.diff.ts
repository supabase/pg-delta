import { diffObjects } from "../base.diff.ts";
import {
  diffPrivileges,
  emitObjectPrivilegeChanges,
  withPublicBuiltInDefault,
} from "../base.privilege-diff.ts";
import type { ObjectDiffContext } from "../diff-context.ts";
import { diffSecurityLabels } from "../security-label.types.ts";
import { deepEqual, hasNonAlterableChanges } from "../utils.ts";
import type { Aggregate } from "./aggregate.model.ts";
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
import {
  CreateSecurityLabelOnAggregate,
  DropSecurityLabelOnAggregate,
} from "./changes/aggregate.security-label.ts";
import type { AggregateChange } from "./changes/aggregate.types.ts";

export function diffAggregates(
  ctx: Pick<
    ObjectDiffContext,
    "version" | "currentUser" | "defaultPrivilegeState"
  >,
  main: Record<string, Aggregate>,
  branch: Record<string, Aggregate>,
): AggregateChange[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: AggregateChange[] = [];

  for (const aggregateId of created) {
    const aggregate = branch[aggregateId];
    changes.push(new CreateAggregate({ aggregate }));

    // OWNER: If the aggregate should be owned by someone other than the current user,
    // emit ALTER AGGREGATE ... OWNER TO after creation
    if (aggregate.owner !== ctx.currentUser) {
      changes.push(
        new AlterAggregateChangeOwner({
          aggregate,
          owner: aggregate.owner,
        }),
      );
    }

    if (aggregate.comment !== null) {
      changes.push(new CreateCommentOnAggregate({ aggregate }));
    }
    for (const label of aggregate.security_labels) {
      changes.push(
        new CreateSecurityLabelOnAggregate({
          aggregate,
          securityLabel: label,
        }),
      );
    }

    // PRIVILEGES: For created objects, compare against default privileges state
    // The migration script will run ALTER DEFAULT PRIVILEGES before CREATE (via constraint spec),
    // so objects are created with the default privileges state in effect.
    // We compare default privileges against desired privileges to generate REVOKE/GRANT statements
    // needed to reach the final desired state.
    const effectiveDefaults = ctx.defaultPrivilegeState.getEffectiveDefaults(
      ctx.currentUser,
      "aggregate",
      aggregate.schema ?? "",
    );
    const creatorFilteredDefaults =
      aggregate.owner !== ctx.currentUser
        ? effectiveDefaults.filter((p) => p.grantee !== ctx.currentUser)
        : effectiveDefaults;
    // aggregate.privileges is the desired object's real ACL, which already
    // reflects PostgreSQL's implicit PUBLIC EXECUTE default (or its absence,
    // if explicitly revoked). Compare it unfiltered against the defaults side
    // with that same built-in default added back in, so both sides are
    // symmetric.
    const desiredPrivileges = aggregate.privileges;
    // Filter out owner privileges - owner always has ALL privileges implicitly
    // and shouldn't be compared. Use the aggregate owner as the reference.
    const privilegeResults = diffPrivileges(
      withPublicBuiltInDefault("aggregate", creatorFilteredDefaults),
      desiredPrivileges,
      aggregate.owner,
    );

    changes.push(
      ...(emitObjectPrivilegeChanges(
        privilegeResults,
        aggregate,
        aggregate,
        "aggregate",
        {
          Grant: GrantAggregatePrivileges,
          Revoke: RevokeAggregatePrivileges,
          RevokeGrantOption: RevokeGrantOptionAggregatePrivileges,
        },
        ctx.version,
      ) as AggregateChange[]),
    );
  }

  for (const aggregateId of dropped) {
    changes.push(new DropAggregate({ aggregate: main[aggregateId] }));
  }

  for (const aggregateId of altered) {
    const mainAggregate = main[aggregateId];
    const branchAggregate = branch[aggregateId];

    const NON_ALTERABLE_FIELDS: Array<keyof Aggregate> = [
      "kind",
      "aggkind",
      "num_direct_args",
      "return_type",
      "return_type_schema",
      "parallel_safety",
      "is_strict",
      "transition_function",
      "state_data_type",
      "state_data_type_schema",
      "state_data_space",
      "final_function",
      "final_function_extra_args",
      "final_function_modify",
      "combine_function",
      "serial_function",
      "deserial_function",
      "initial_condition",
      "moving_transition_function",
      "moving_inverse_function",
      "moving_state_data_type",
      "moving_state_data_type_schema",
      "moving_state_data_space",
      "moving_final_function",
      "moving_final_function_extra_args",
      "moving_final_function_modify",
      "moving_initial_condition",
      "sort_operator",
      "argument_count",
      "argument_default_count",
      "argument_names",
      "argument_types",
      "all_argument_types",
      "argument_modes",
      "argument_defaults",
      "identityArguments",
    ];

    const nonAlterableChanged = hasNonAlterableChanges(
      mainAggregate,
      branchAggregate,
      NON_ALTERABLE_FIELDS,
      {
        argument_names: deepEqual,
        argument_types: deepEqual,
        all_argument_types: deepEqual,
        argument_modes: deepEqual,
      },
    );

    if (nonAlterableChanged) {
      changes.push(
        new CreateAggregate({ aggregate: branchAggregate, orReplace: true }),
      );
      continue;
    }

    if (mainAggregate.owner !== branchAggregate.owner) {
      changes.push(
        new AlterAggregateChangeOwner({
          aggregate: mainAggregate,
          owner: branchAggregate.owner,
        }),
      );
    }

    if (mainAggregate.comment !== branchAggregate.comment) {
      if (branchAggregate.comment === null) {
        changes.push(new DropCommentOnAggregate({ aggregate: mainAggregate }));
      } else {
        changes.push(
          new CreateCommentOnAggregate({ aggregate: branchAggregate }),
        );
      }
    }

    // SECURITY LABELS
    changes.push(
      ...diffSecurityLabels<
        CreateSecurityLabelOnAggregate | DropSecurityLabelOnAggregate
      >(
        mainAggregate.security_labels,
        branchAggregate.security_labels,
        (securityLabel) =>
          new CreateSecurityLabelOnAggregate({
            aggregate: branchAggregate,
            securityLabel,
          }),
        (securityLabel) =>
          new DropSecurityLabelOnAggregate({
            aggregate: mainAggregate,
            securityLabel,
          }),
      ),
    );

    // PRIVILEGES
    // Both mainAggregate.privileges and branchAggregate.privileges are
    // extracted via COALESCE(<acl-column>, acldefault(...)), so PostgreSQL's
    // implicit PUBLIC EXECUTE default is already correctly represented (or
    // absent, if explicitly revoked) on both sides. Diff them unfiltered.
    // Filter out owner privileges - owner always has ALL privileges implicitly
    // and shouldn't be compared. Use branch owner as the reference.
    const privilegeResults = diffPrivileges(
      mainAggregate.privileges,
      branchAggregate.privileges,
      branchAggregate.owner,
    );

    changes.push(
      ...(emitObjectPrivilegeChanges(
        privilegeResults,
        branchAggregate,
        mainAggregate,
        "aggregate",
        {
          Grant: GrantAggregatePrivileges,
          Revoke: RevokeAggregatePrivileges,
          RevokeGrantOption: RevokeGrantOptionAggregatePrivileges,
        },
        ctx.version,
      ) as AggregateChange[]),
    );
  }

  return changes;
}
