import { diffObjects } from "../../base.diff.ts";
import {
  diffPrivileges,
  emitObjectPrivilegeChanges,
  filterPublicBuiltInDefaults,
} from "../../base.privilege-diff.ts";
import type { ObjectDiffContext } from "../../diff-context.ts";
import { diffSecurityLabels } from "../../security-label.types.ts";
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
import {
  CreateSecurityLabelOnEnum,
  DropSecurityLabelOnEnum,
} from "./changes/enum.security-label.ts";
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
  ctx: Pick<
    ObjectDiffContext,
    "version" | "currentUser" | "defaultPrivilegeState"
  >,
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
    for (const label of createdEnum.security_labels) {
      changes.push(
        new CreateSecurityLabelOnEnum({
          enum: createdEnum,
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
      "enum",
      createdEnum.schema ?? "",
    );
    const creatorFilteredDefaults =
      createdEnum.owner !== ctx.currentUser
        ? effectiveDefaults.filter((p) => p.grantee !== ctx.currentUser)
        : effectiveDefaults;
    // Filter out PUBLIC's built-in default USAGE privilege (PostgreSQL grants it automatically)
    // Reference: https://www.postgresql.org/docs/17/ddl-priv.html Table 5.2
    // This prevents generating unnecessary "GRANT USAGE TO PUBLIC" statements
    const desiredPrivileges = filterPublicBuiltInDefaults(
      "enum",
      createdEnum.privileges,
    );
    // Filter out owner privileges - owner always has ALL privileges implicitly
    // and shouldn't be compared. Use the enum owner as the reference.
    const privilegeResults = diffPrivileges(
      filterPublicBuiltInDefaults("enum", creatorFilteredDefaults),
      desiredPrivileges,
      createdEnum.owner,
    );

    changes.push(
      ...(emitObjectPrivilegeChanges(
        privilegeResults,
        createdEnum,
        createdEnum,
        "enum",
        {
          Grant: GrantEnumPrivileges,
          Revoke: RevokeEnumPrivileges,
          RevokeGrantOption: RevokeGrantOptionEnumPrivileges,
        },
        ctx.version,
      ) as EnumChange[]),
    );
  }

  for (const enumId of dropped) {
    changes.push(new DropEnum({ enum: main[enumId] }));
  }

  for (const enumId of altered) {
    const mainEnum = main[enumId];
    const branchEnum = branch[enumId];

    // If labels were removed (branch is missing labels present in main),
    // recreate the enum to avoid relying on unsupported DROP VALUE operations.
    const removedLabels = mainEnum.labels
      .map((l) => l.label)
      .filter((label) => !branchEnum.labels.some((b) => b.label === label));
    if (removedLabels.length > 0) {
      changes.push(new DropEnum({ enum: mainEnum }));
      changes.push(new CreateEnum({ enum: branchEnum }));

      if (branchEnum.owner !== ctx.currentUser) {
        changes.push(
          new AlterEnumChangeOwner({
            enum: branchEnum,
            owner: branchEnum.owner,
          }),
        );
      }

      if (branchEnum.comment !== null) {
        changes.push(new CreateCommentOnEnum({ enum: branchEnum }));
      }

      const effectiveDefaults = ctx.defaultPrivilegeState.getEffectiveDefaults(
        ctx.currentUser,
        "enum",
        branchEnum.schema ?? "",
      );
      const creatorFilteredDefaults =
        branchEnum.owner !== ctx.currentUser
          ? effectiveDefaults.filter((p) => p.grantee !== ctx.currentUser)
          : effectiveDefaults;
      const desiredPrivileges = filterPublicBuiltInDefaults(
        "enum",
        branchEnum.privileges,
      );
      const privilegeResults = diffPrivileges(
        filterPublicBuiltInDefaults("enum", creatorFilteredDefaults),
        desiredPrivileges,
        branchEnum.owner,
      );

      changes.push(
        ...(emitObjectPrivilegeChanges(
          privilegeResults,
          branchEnum,
          branchEnum,
          "enum",
          {
            Grant: GrantEnumPrivileges,
            Revoke: RevokeEnumPrivileges,
            RevokeGrantOption: RevokeGrantOptionEnumPrivileges,
          },
          ctx.version,
        ) as EnumChange[]),
      );

      continue;
    }

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

    // SECURITY LABELS
    changes.push(
      ...diffSecurityLabels<
        CreateSecurityLabelOnEnum | DropSecurityLabelOnEnum
      >(
        mainEnum.security_labels,
        branchEnum.security_labels,
        (securityLabel) =>
          new CreateSecurityLabelOnEnum({
            enum: branchEnum,
            securityLabel,
          }),
        (securityLabel) =>
          new DropSecurityLabelOnEnum({
            enum: mainEnum,
            securityLabel,
          }),
      ),
    );

    // PRIVILEGES
    // Filter out PUBLIC's built-in default USAGE privilege from main catalog
    // (PostgreSQL grants it automatically, so we shouldn't compare it)
    const mainPrivilegesFiltered = filterPublicBuiltInDefaults(
      "enum",
      mainEnum.privileges,
    );
    // Filter out PUBLIC's built-in default USAGE privilege from branch catalog
    const branchPrivilegesFiltered = filterPublicBuiltInDefaults(
      "enum",
      branchEnum.privileges,
    );
    // Filter out owner privileges - owner always has ALL privileges implicitly
    // and shouldn't be compared. Use branch owner as the reference.
    const privilegeResults = diffPrivileges(
      mainPrivilegesFiltered,
      branchPrivilegesFiltered,
      branchEnum.owner,
    );

    changes.push(
      ...(emitObjectPrivilegeChanges(
        privilegeResults,
        branchEnum,
        mainEnum,
        "enum",
        {
          Grant: GrantEnumPrivileges,
          Revoke: RevokeEnumPrivileges,
          RevokeGrantOption: RevokeGrantOptionEnumPrivileges,
        },
        ctx.version,
      ) as EnumChange[]),
    );

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

  // Maintain a working list of labels (by name) to calculate correct BEFORE/AFTER
  // anchors as we simulate applying the additions in order.
  const branchOrdered = [...branchEnum.labels].sort(
    (a, b) => a.sort_order - b.sort_order,
  );
  const workingLabels = [...mainEnum.labels].map((l) => l.label);
  const pendingValues = new Set(addedValues);

  while (pendingValues.size > 0) {
    let emitted = false;

    for (const newValue of pendingValues) {
      const branchIdx = branchOrdered.findIndex((l) => l.label === newValue);
      if (branchIdx === -1) {
        pendingValues.delete(newValue);
        emitted = true;
        continue;
      }

      const prevBranch = branchOrdered[branchIdx - 1]?.label;
      const nextBranch = branchOrdered[branchIdx + 1]?.label;

      let position: { before?: string; after?: string } | undefined;
      let insertIdx: number | undefined;

      // Prefer AFTER when prevBranch exists in workingLabels (more natural for sequential additions)
      // Use BEFORE only when we need to insert before the first value or when prevBranch doesn't exist
      if (prevBranch && workingLabels.includes(prevBranch)) {
        position = { after: prevBranch };
        // Insert after the previous label in our working list
        insertIdx = workingLabels.indexOf(prevBranch) + 1;
      } else if (nextBranch && workingLabels.includes(nextBranch)) {
        // Insert before nextBranch when prevBranch doesn't exist (e.g., adding at beginning)
        position = { before: nextBranch };
        insertIdx = workingLabels.indexOf(nextBranch);
      } else if (nextBranch) {
        // nextBranch exists but not in workingLabels yet (shouldn't happen in normal flow)
        continue;
      } else {
        // Fallback: append to the end
        if (prevBranch) continue;
        if (workingLabels.length === 0) continue;
        position = { after: workingLabels[workingLabels.length - 1] };
        insertIdx = workingLabels.length;
      }

      if (insertIdx === undefined) continue;
      workingLabels.splice(insertIdx, 0, newValue);
      changes.push(
        new AlterEnumAddValue({ enum: mainEnum, newValue, position }),
      );
      pendingValues.delete(newValue);
      emitted = true;
    }

    if (!emitted) {
      throw new Error(
        `Unable to plan enum label additions for ${mainEnum.schema}.${mainEnum.name}: no pending value has an existing enum label anchor`,
      );
    }
  }

  // Complex changes (removals, resorting) are currently not auto-handled.
  // We intentionally avoid emitting drop+create to prevent data loss.

  return changes;
}
