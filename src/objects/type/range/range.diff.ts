import type { DefaultPrivilegeState } from "../../base.default-privileges.ts";
import { diffObjects } from "../../base.diff.ts";
import {
  diffPrivileges,
  filterPublicBuiltInDefaults,
  groupPrivilegesByGrantable,
} from "../../base.privilege-diff.ts";
import type { Role } from "../../role/role.model.ts";
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
 * @param ctx - Context containing version, currentUser, and defaultPrivilegeState
 * @param main - The ranges in the main catalog.
 * @param branch - The ranges in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffRanges(
  ctx: {
    version: number;
    currentUser: string;
    defaultPrivilegeState: DefaultPrivilegeState;
    mainRoles: Record<string, Role>;
  },
  main: Record<string, Range>,
  branch: Record<string, Range>,
): RangeChange[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: RangeChange[] = [];

  for (const id of created) {
    const createdRange = branch[id];
    changes.push(new CreateRange({ range: createdRange }));

    // OWNER: If the range type should be owned by someone other than the current user,
    // emit ALTER TYPE ... OWNER TO after creation
    if (createdRange.owner !== ctx.currentUser) {
      changes.push(
        new AlterRangeChangeOwner({
          range: createdRange,
          owner: createdRange.owner,
        }),
      );
    }

    if (createdRange.comment !== null) {
      changes.push(new CreateCommentOnRange({ range: createdRange }));
    }

    // PRIVILEGES: For created objects, compare against default privileges state
    // The migration script will run ALTER DEFAULT PRIVILEGES before CREATE (via constraint spec),
    // so objects are created with the default privileges state in effect.
    // We compare default privileges against desired privileges to generate REVOKE/GRANT statements
    // needed to reach the final desired state.
    const effectiveDefaults = ctx.defaultPrivilegeState.getEffectiveDefaults(
      ctx.currentUser,
      "range",
      createdRange.schema ?? "",
    );
    // Filter out PUBLIC's built-in default USAGE privilege (PostgreSQL grants it automatically)
    // Reference: https://www.postgresql.org/docs/17/ddl-priv.html Table 5.2
    // This prevents generating unnecessary "GRANT USAGE TO PUBLIC" statements
    const desiredPrivileges = filterPublicBuiltInDefaults(
      "range",
      createdRange.privileges,
    );
    // Filter out owner privileges - owner always has ALL privileges implicitly
    // and shouldn't be compared. Use the range owner as the reference.
    const privilegeResults = diffPrivileges(
      effectiveDefaults,
      desiredPrivileges,
      createdRange.owner,
    );

    // Generate grant changes
    for (const [grantee, result] of privilegeResults) {
      if (result.grants.length > 0) {
        const grantGroups = groupPrivilegesByGrantable(result.grants);
        for (const [grantable, list] of grantGroups) {
          void grantable;
          changes.push(
            new GrantRangePrivileges({
              range: createdRange,
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
              range: createdRange,
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
            range: createdRange,
            grantee,
            privilegeNames: result.revokeGrantOption,
            version: ctx.version,
          }),
        );
      }
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
      // Filter out PUBLIC's built-in default USAGE privilege from main catalog
      // (PostgreSQL grants it automatically, so we shouldn't compare it)
      const mainPrivilegesFiltered = filterPublicBuiltInDefaults(
        "range",
        mainRange.privileges,
      );
      // Filter out PUBLIC's built-in default USAGE privilege from branch catalog
      const branchPrivilegesFiltered = filterPublicBuiltInDefaults(
        "range",
        branchRange.privileges,
      );
      // Filter out owner privileges - owner always has ALL privileges implicitly
      // and shouldn't be compared. Use branch owner as the reference.
      const privilegeResults = diffPrivileges(
        mainPrivilegesFiltered,
        branchPrivilegesFiltered,
        branchRange.owner,
        ctx.mainRoles,
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
