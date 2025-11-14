import type { DefaultPrivilegeState } from "../base.default-privileges.ts";
import { diffObjects } from "../base.diff.ts";
import {
  diffPrivileges,
  filterPublicBuiltInDefaults,
  groupPrivilegesByGrantable,
} from "../base.privilege-diff.ts";
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
import type { AggregateChange } from "./changes/aggregate.types.ts";

export function diffAggregates(
  ctx: {
    version: number;
    currentUser: string;
    defaultPrivilegeState: DefaultPrivilegeState;
  },
  main: Record<string, Aggregate>,
  branch: Record<string, Aggregate>,
): AggregateChange[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: AggregateChange[] = [];

  for (const aggregateId of created) {
    const aggregate = branch[aggregateId];
    changes.push(new CreateAggregate({ aggregate }));
    if (aggregate.comment !== null) {
      changes.push(new CreateCommentOnAggregate({ aggregate }));
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
    // Filter out PUBLIC's built-in default EXECUTE privilege (PostgreSQL grants it automatically)
    // Reference: https://www.postgresql.org/docs/17/ddl-priv.html Table 5.2
    // This prevents generating unnecessary "GRANT EXECUTE TO PUBLIC" statements
    const desiredPrivileges = filterPublicBuiltInDefaults(
      "aggregate",
      aggregate.privileges,
    );
    const privilegeResults = diffPrivileges(
      effectiveDefaults,
      desiredPrivileges,
    );

    // Generate grant changes
    for (const [grantee, result] of privilegeResults) {
      if (result.grants.length > 0) {
        const grantGroups = groupPrivilegesByGrantable(result.grants);
        for (const [, list] of grantGroups) {
          changes.push(
            new GrantAggregatePrivileges({
              aggregate,
              grantee,
              privileges: list,
              version: ctx.version,
            }),
          );
        }
      }

      // Generate revoke changes
      if (result.revokes.length > 0) {
        const revokeGroups = groupPrivilegesByGrantable(result.revokes);
        for (const [, list] of revokeGroups) {
          changes.push(
            new RevokeAggregatePrivileges({
              aggregate,
              grantee,
              privileges: list,
              version: ctx.version,
            }),
          );
        }
      }

      // Generate revoke grant option changes
      if (result.revokeGrantOption.length > 0) {
        changes.push(
          new RevokeGrantOptionAggregatePrivileges({
            aggregate,
            grantee,
            privilegeNames: result.revokeGrantOption,
            version: ctx.version,
          }),
        );
      }
    }
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

    const privilegeResults = diffPrivileges(
      mainAggregate.privileges,
      branchAggregate.privileges,
    );

    for (const [grantee, result] of privilegeResults) {
      if (result.grants.length > 0) {
        const grantGroups = groupPrivilegesByGrantable(result.grants);
        for (const [, list] of grantGroups) {
          changes.push(
            new GrantAggregatePrivileges({
              aggregate: branchAggregate,
              grantee,
              privileges: list,
              version: ctx.version,
            }),
          );
        }
      }

      if (result.revokes.length > 0) {
        const revokeGroups = groupPrivilegesByGrantable(result.revokes);
        for (const [, list] of revokeGroups) {
          changes.push(
            new RevokeAggregatePrivileges({
              aggregate: mainAggregate,
              grantee,
              privileges: list,
              version: ctx.version,
            }),
          );
        }
      }

      if (result.revokeGrantOption.length > 0) {
        changes.push(
          new RevokeGrantOptionAggregatePrivileges({
            aggregate: mainAggregate,
            grantee,
            privilegeNames: result.revokeGrantOption,
            version: ctx.version,
          }),
        );
      }
    }
  }

  return changes;
}
