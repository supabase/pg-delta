import { diffObjects } from "../../base.diff.ts";
import {
  diffPrivileges,
  groupPrivilegesByGrantable,
} from "../../base.privilege-diff.ts";
import { hasNonAlterableChanges } from "../../utils.ts";
import { AlterRangeChangeOwner } from "./changes/range.alter.ts";
import {
  CreateCommentOnRange,
  DropCommentOnRange,
} from "./changes/range.comment.ts";
import { CreateRange } from "./changes/range.create.ts";
import { DropRange } from "./changes/range.drop.ts";
import {
  GrantRangePrivileges,
  RevokeGrantOptionRangePrivileges,
  RevokeRangePrivileges,
} from "./changes/range.privilege.ts";
import type { RangeChange } from "./changes/range.types.ts";
import type { Range } from "./range.model.ts";

/**
 * Diff two sets of range types from main and branch catalogs.
 *
 * @param main - The ranges in the main catalog.
 * @param branch - The ranges in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffRanges(
  ctx: {
    version: number;
    currentUser?: string;
    defaultPrivilegeState?: unknown;
  },
  main: Record<string, Range>,
  branch: Record<string, Range>,
): RangeChange[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: RangeChange[] = [];

  for (const id of created) {
    const createdRange = branch[id];
    changes.push(new CreateRange({ range: createdRange }));
    if (createdRange.comment !== null) {
      changes.push(new CreateCommentOnRange({ range: createdRange }));
    }
  }

  for (const id of dropped) {
    changes.push(new DropRange({ range: main[id] }));
  }

  for (const id of altered) {
    const mainRange = main[id];
    const branchRange = branch[id];

    const NON_ALTERABLE_FIELDS: Array<keyof Range> = [
      // Changes to these require DROP + CREATE
      "subtype_schema",
      "subtype_str",
      "collation",
      "canonical_function_schema",
      "canonical_function_name",
      "subtype_diff_schema",
      "subtype_diff_name",
      "subtype_opclass_schema",
      "subtype_opclass_name",
    ];

    const nonAlterablePropsChanged = hasNonAlterableChanges(
      mainRange,
      branchRange,
      NON_ALTERABLE_FIELDS,
    );

    if (nonAlterablePropsChanged) {
      changes.push(
        new DropRange({ range: mainRange }),
        new CreateRange({ range: branchRange }),
      );
    } else {
      if (mainRange.owner !== branchRange.owner) {
        changes.push(
          new AlterRangeChangeOwner({
            range: mainRange,
            owner: branchRange.owner,
          }),
        );
      }

      // COMMENT
      if (mainRange.comment !== branchRange.comment) {
        if (branchRange.comment === null) {
          changes.push(new DropCommentOnRange({ range: mainRange }));
        } else {
          changes.push(new CreateCommentOnRange({ range: branchRange }));
        }
      }

      // PRIVILEGES
      const privilegeResults = diffPrivileges(
        mainRange.privileges,
        branchRange.privileges,
      );

      for (const [grantee, result] of privilegeResults) {
        // Generate grant changes
        if (result.grants.length > 0) {
          const grantGroups = groupPrivilegesByGrantable(result.grants);
          for (const [grantable, list] of grantGroups) {
            void grantable;
            changes.push(
              new GrantRangePrivileges({
                range: branchRange,
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
          for (const [grantable, list] of revokeGroups) {
            void grantable;
            changes.push(
              new RevokeRangePrivileges({
                range: mainRange,
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
            new RevokeGrantOptionRangePrivileges({
              range: mainRange,
              grantee,
              privilegeNames: result.revokeGrantOption,
              version: ctx.version,
            }),
          );
        }
      }
    }
  }

  return changes;
}
