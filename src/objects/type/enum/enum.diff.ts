import type { DefaultPrivilegeState } from "../../base.default-privileges.ts";
import { diffObjects } from "../../base.diff.ts";
import {
  diffPrivileges,
  filterPublicBuiltInDefaults,
  groupPrivilegesByGrantable,
} from "../../base.privilege-diff.ts";
import {
  AlterEnumAddValue,
  AlterEnumChangeOwner,
} from "./changes/enum.alter.ts";
import {
  CreateCommentOnEnum,
  DropCommentOnEnum,
} from "./changes/enum.comment.ts";
import { CreateEnum } from "./changes/enum.create.ts";
import { DropEnum } from "./changes/enum.drop.ts";
import {
  GrantEnumPrivileges,
  RevokeEnumPrivileges,
  RevokeGrantOptionEnumPrivileges,
} from "./changes/enum.privilege.ts";
import type { EnumChange } from "./changes/enum.types.ts";
import type { Enum } from "./enum.model.ts";

/**
 * Diff two sets of enums from main and branch catalogs.
 *
 * @param ctx - Context containing version, currentUser, and defaultPrivilegeState
 * @param main - The enums in the main catalog.
 * @param branch - The enums in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffEnums(
  ctx: {
    version: number;
    currentUser: string;
    defaultPrivilegeState: DefaultPrivilegeState;
  },
  main: Record<string, Enum>,
  branch: Record<string, Enum>,
): EnumChange[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: EnumChange[] = [];

  for (const enumId of created) {
    const createdEnum = branch[enumId];
    changes.push(new CreateEnum({ enum: createdEnum }));

    // OWNER: If the enum should be owned by someone other than the current user,
    // emit ALTER TYPE ... OWNER TO after creation
    if (createdEnum.owner !== ctx.currentUser) {
      changes.push(
        new AlterEnumChangeOwner({
          enum: createdEnum,
          owner: createdEnum.owner,
        }),
      );
    }

    if (createdEnum.comment !== null) {
      changes.push(new CreateCommentOnEnum({ enum: createdEnum }));
    }

    // PRIVILEGES: For created objects, compare against default privileges state
    // The migration script will run ALTER DEFAULT PRIVILEGES before CREATE (via constraint spec),
    // so objects are created with the default privileges state in effect.
    // We compare default privileges against desired privileges to generate REVOKE/GRANT statements
    // needed to reach the final desired state.
    const effectiveDefaults = ctx.defaultPrivilegeState.getEffectiveDefaults(
      ctx.currentUser,
      "enum",
      createdEnum.schema ?? "",
    );
    // Filter out PUBLIC's built-in default USAGE privilege (PostgreSQL grants it automatically)
    // Reference: https://www.postgresql.org/docs/17/ddl-priv.html Table 5.2
    // This prevents generating unnecessary "GRANT USAGE TO PUBLIC" statements
    const desiredPrivileges = filterPublicBuiltInDefaults(
      "enum",
      createdEnum.privileges,
    );
    const privilegeResults = diffPrivileges(
      effectiveDefaults,
      desiredPrivileges,
    );

    // Generate grant changes
    for (const [grantee, result] of privilegeResults) {
      if (result.grants.length > 0) {
        const grantGroups = groupPrivilegesByGrantable(result.grants);
        for (const [grantable, list] of grantGroups) {
          void grantable;
          changes.push(
            new GrantEnumPrivileges({
              enum: createdEnum,
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
            new RevokeEnumPrivileges({
              enum: createdEnum,
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
          new RevokeGrantOptionEnumPrivileges({
            enum: createdEnum,
            grantee,
            privilegeNames: result.revokeGrantOption,
            version: ctx.version,
          }),
        );
      }
    }
  }

  for (const enumId of dropped) {
    changes.push(new DropEnum({ enum: main[enumId] }));
  }

  for (const enumId of altered) {
    const mainEnum = main[enumId];
    const branchEnum = branch[enumId];

    // OWNER
    if (mainEnum.owner !== branchEnum.owner) {
      changes.push(
        new AlterEnumChangeOwner({ enum: mainEnum, owner: branchEnum.owner }),
      );
    }

    // LABELS (enum values)
    if (JSON.stringify(mainEnum.labels) !== JSON.stringify(branchEnum.labels)) {
      const labelChanges = diffEnumLabels(mainEnum, branchEnum);
      changes.push(...labelChanges);
    }

    // COMMENT
    if (mainEnum.comment !== branchEnum.comment) {
      if (branchEnum.comment === null) {
        changes.push(new DropCommentOnEnum({ enum: mainEnum }));
      } else {
        changes.push(new CreateCommentOnEnum({ enum: branchEnum }));
      }
    }

    // PRIVILEGES
    const privilegeResults = diffPrivileges(
      mainEnum.privileges,
      branchEnum.privileges,
    );

    for (const [grantee, result] of privilegeResults) {
      // Generate grant changes
      if (result.grants.length > 0) {
        const grantGroups = groupPrivilegesByGrantable(result.grants);
        for (const [grantable, list] of grantGroups) {
          void grantable;
          changes.push(
            new GrantEnumPrivileges({
              enum: branchEnum,
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
            new RevokeEnumPrivileges({
              enum: mainEnum,
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
          new RevokeGrantOptionEnumPrivileges({
            enum: mainEnum,
            grantee,
            privilegeNames: result.revokeGrantOption,
            version: ctx.version,
          }),
        );
      }
    }

    // Note: Enum renaming would also use ALTER TYPE ... RENAME TO ...
    // But since our Enum model uses 'name' as the identity field,
    // a name change would be handled as drop + create by diffObjects()
  }

  return changes;
}

/**
 * Diff enum labels to determine what ALTER TYPE statements are needed.
 * This implementation properly handles enum value positioning using sort_order.
 * Note: We cannot reliably detect renames, so we only handle additions.
 */
function diffEnumLabels(mainEnum: Enum, branchEnum: Enum): EnumChange[] {
  const changes: EnumChange[] = [];

  // Create maps for efficient lookup
  const mainLabelMap = new Map(
    mainEnum.labels.map((label) => [label.label, label.sort_order]),
  );
  const branchLabelMap = new Map(
    branchEnum.labels.map((label) => [label.label, label.sort_order]),
  );

  // Find added values (values in branch but not in main)
  const addedValues = Array.from(branchLabelMap.keys()).filter(
    (label) => !mainLabelMap.has(label),
  );

  for (const newValue of addedValues) {
    const newValueSortOrder = branchLabelMap.get(newValue);
    if (newValueSortOrder === undefined) {
      continue;
    }

    // Find the correct position for the new value
    const position = findEnumValuePosition(mainEnum.labels, newValueSortOrder);

    changes.push(new AlterEnumAddValue({ enum: mainEnum, newValue, position }));
  }

  // Complex changes (removals, resorting) are currently not auto-handled.
  // We intentionally avoid emitting drop+create to prevent data loss.

  return changes;
}

/**
 * Find the correct position for a new enum value based on sort_order.
 * Returns position object with 'before' or 'after' clause, or undefined if no positioning needed.
 */
function findEnumValuePosition(
  mainLabels: Array<{ label: string; sort_order: number }>,
  newValueSortOrder: number,
): { before?: string; after?: string } | undefined {
  // Sort main labels by sort_order to understand the current order
  const sortedMainLabels = [...mainLabels].sort(
    (a, b) => a.sort_order - b.sort_order,
  );

  // Find where the new value should be inserted
  let insertIndex = 0;
  for (let i = 0; i < sortedMainLabels.length; i++) {
    if (newValueSortOrder > sortedMainLabels[i].sort_order) {
      insertIndex = i + 1;
    } else {
      break;
    }
  }

  // Determine the position clause
  if (insertIndex === 0) {
    // Insert at the beginning
    if (sortedMainLabels.length > 0) {
      return { before: sortedMainLabels[0].label };
    }
  } else if (insertIndex === sortedMainLabels.length) {
    // Insert at the end
    if (sortedMainLabels.length > 0) {
      return { after: sortedMainLabels[sortedMainLabels.length - 1].label };
    }
  } else {
    // Insert in the middle
    return { before: sortedMainLabels[insertIndex].label };
  }

  // No positioning needed (empty enum or single value)
  return undefined;
}
