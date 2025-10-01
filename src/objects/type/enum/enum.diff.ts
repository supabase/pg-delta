import type { Change } from "../../base.change.ts";
import { diffObjects } from "../../base.diff.ts";
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
import type { Enum } from "./enum.model.ts";

/**
 * Diff two sets of enums from main and branch catalogs.
 *
 * @param main - The enums in the main catalog.
 * @param branch - The enums in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffEnums(
  main: Record<string, Enum>,
  branch: Record<string, Enum>,
): Change[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: Change[] = [];

  for (const enumId of created) {
    const createdEnum = branch[enumId];
    changes.push(new CreateEnum({ enum: createdEnum }));
    if (createdEnum.comment !== null) {
      changes.push(new CreateCommentOnEnum({ enum: createdEnum }));
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
        new AlterEnumChangeOwner({
          main: mainEnum,
          branch: branchEnum,
        }),
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
function diffEnumLabels(mainEnum: Enum, branchEnum: Enum): Change[] {
  const changes: Change[] = [];

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

    changes.push(
      new AlterEnumAddValue({
        main: mainEnum,
        branch: branchEnum,
        newValue,
        position,
      }),
    );
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
