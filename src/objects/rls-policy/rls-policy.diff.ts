import type { Change } from "../base.change.ts";
import { diffObjects } from "../base.diff.ts";
import { deepEqual, hasNonAlterableChanges } from "../utils.ts";
import {
  AlterRlsPolicySetRoles,
  AlterRlsPolicySetUsingExpression,
  AlterRlsPolicySetWithCheckExpression,
} from "./changes/rls-policy.alter.ts";
import {
  CreateCommentOnRlsPolicy,
  DropCommentOnRlsPolicy,
} from "./changes/rls-policy.comment.ts";
import { CreateRlsPolicy } from "./changes/rls-policy.create.ts";
import { DropRlsPolicy } from "./changes/rls-policy.drop.ts";
import type { RlsPolicy } from "./rls-policy.model.ts";

/**
 * Diff two sets of RLS policies from main and branch catalogs.
 *
 * @param main - The RLS policies in the main catalog.
 * @param branch - The RLS policies in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffRlsPolicies(
  main: Record<string, RlsPolicy>,
  branch: Record<string, RlsPolicy>,
): Change[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: Change[] = [];

  for (const rlsPolicyId of created) {
    const pol = branch[rlsPolicyId];
    changes.push(new CreateRlsPolicy({ rlsPolicy: pol }));
    if (pol.comment !== null) {
      changes.push(new CreateCommentOnRlsPolicy({ rlsPolicy: pol }));
    }
  }

  for (const rlsPolicyId of dropped) {
    changes.push(new DropRlsPolicy({ rlsPolicy: main[rlsPolicyId] }));
  }

  for (const rlsPolicyId of altered) {
    const mainRlsPolicy = main[rlsPolicyId];
    const branchRlsPolicy = branch[rlsPolicyId];

    // Check if non-alterable properties have changed
    // These require dropping and recreating the RLS policy
    // These attributes require drop+create (Postgres has no ALTER for them)
    const NON_ALTERABLE_FIELDS: Array<keyof RlsPolicy> = [
      "command",
      "permissive",
    ];
    const nonAlterablePropsChanged = hasNonAlterableChanges(
      mainRlsPolicy,
      branchRlsPolicy,
      NON_ALTERABLE_FIELDS,
      {},
    );

    if (nonAlterablePropsChanged) {
      // Replace the entire RLS policy (drop + create)
      changes.push(
        new DropRlsPolicy({ rlsPolicy: mainRlsPolicy }),
        new CreateRlsPolicy({ rlsPolicy: branchRlsPolicy }),
      );
    } else {
      // Only alterable properties changed - check each one

      // ROLES (TO ...)
      const rolesEqual = deepEqual(mainRlsPolicy.roles, branchRlsPolicy.roles);
      if (!rolesEqual) {
        changes.push(
          new AlterRlsPolicySetRoles({
            main: mainRlsPolicy,
            branch: branchRlsPolicy,
          }),
        );
      }

      // USING expression
      if (mainRlsPolicy.using_expression !== branchRlsPolicy.using_expression) {
        changes.push(
          new AlterRlsPolicySetUsingExpression({
            main: mainRlsPolicy,
            branch: branchRlsPolicy,
          }),
        );
      }

      // WITH CHECK expression
      if (
        mainRlsPolicy.with_check_expression !==
        branchRlsPolicy.with_check_expression
      ) {
        changes.push(
          new AlterRlsPolicySetWithCheckExpression({
            main: mainRlsPolicy,
            branch: branchRlsPolicy,
          }),
        );
      }

      // COMMENT
      if (mainRlsPolicy.comment !== branchRlsPolicy.comment) {
        if (branchRlsPolicy.comment === null) {
          changes.push(
            new DropCommentOnRlsPolicy({ rlsPolicy: mainRlsPolicy }),
          );
        } else {
          changes.push(
            new CreateCommentOnRlsPolicy({ rlsPolicy: branchRlsPolicy }),
          );
        }
      }

      // Note: RLS policy renaming would require drop+create due to identity fields
    }
  }

  return changes;
}
