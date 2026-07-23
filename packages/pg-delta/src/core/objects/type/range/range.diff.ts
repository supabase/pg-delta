import { diffObjects } from "../../base.diff.ts";
import {
  diffPrivileges,
  emitObjectPrivilegeChanges,
  withPublicBuiltInDefault,
} from "../../base.privilege-diff.ts";
import type { ObjectDiffContext } from "../../diff-context.ts";
import { diffSecurityLabels } from "../../security-label.types.ts";
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
import {
  CreateSecurityLabelOnRange,
  DropSecurityLabelOnRange,
} from "./changes/range.security-label.ts";
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
  ctx: Pick<
    ObjectDiffContext,
    "version" | "currentUser" | "defaultPrivilegeState"
  >,
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
    for (const label of createdRange.security_labels) {
      changes.push(
        new CreateSecurityLabelOnRange({
          range: createdRange,
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
      "range",
      createdRange.schema ?? "",
    );
    const creatorFilteredDefaults =
      createdRange.owner !== ctx.currentUser
        ? effectiveDefaults.filter((p) => p.grantee !== ctx.currentUser)
        : effectiveDefaults;
    // createdRange.privileges is the desired object's real ACL, which already
    // reflects PostgreSQL's implicit PUBLIC USAGE default (or its absence, if
    // explicitly revoked). Compare it unfiltered against the defaults side
    // with that same built-in default added back in, so both sides are
    // symmetric.
    const desiredPrivileges = createdRange.privileges;
    // Filter out owner privileges - owner always has ALL privileges implicitly
    // and shouldn't be compared. Use the range owner as the reference.
    const privilegeResults = diffPrivileges(
      withPublicBuiltInDefault("range", creatorFilteredDefaults),
      desiredPrivileges,
      createdRange.owner,
    );

    changes.push(
      ...(emitObjectPrivilegeChanges(
        privilegeResults,
        createdRange,
        createdRange,
        "range",
        {
          Grant: GrantRangePrivileges,
          Revoke: RevokeRangePrivileges,
          RevokeGrantOption: RevokeGrantOptionRangePrivileges,
        },
        ctx.version,
      ) as RangeChange[]),
    );
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

      // SECURITY LABELS
      changes.push(
        ...diffSecurityLabels<
          CreateSecurityLabelOnRange | DropSecurityLabelOnRange
        >(
          mainRange.security_labels,
          branchRange.security_labels,
          (securityLabel) =>
            new CreateSecurityLabelOnRange({
              range: branchRange,
              securityLabel,
            }),
          (securityLabel) =>
            new DropSecurityLabelOnRange({
              range: mainRange,
              securityLabel,
            }),
        ),
      );

      // PRIVILEGES
      // Both mainRange.privileges and branchRange.privileges are extracted
      // via COALESCE(<acl-column>, acldefault(...)), so PostgreSQL's implicit
      // PUBLIC USAGE default is already correctly represented (or absent, if
      // explicitly revoked) on both sides. Diff them unfiltered.
      // Filter out owner privileges - owner always has ALL privileges implicitly
      // and shouldn't be compared. Use branch owner as the reference.
      const privilegeResults = diffPrivileges(
        mainRange.privileges,
        branchRange.privileges,
        branchRange.owner,
      );

      changes.push(
        ...(emitObjectPrivilegeChanges(
          privilegeResults,
          branchRange,
          mainRange,
          "range",
          {
            Grant: GrantRangePrivileges,
            Revoke: RevokeRangePrivileges,
            RevokeGrantOption: RevokeGrantOptionRangePrivileges,
          },
          ctx.version,
        ) as RangeChange[]),
      );
    }
  }

  return changes;
}
