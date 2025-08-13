import type { Change } from "../base.change.ts";
import { diffObjects } from "../base.diff.ts";
import {
  AlterEnumAddValue,
  AlterEnumChangeOwner,
  ReplaceEnum,
} from "./changes/enum.alter.ts";
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
    changes.push(new CreateEnum({ enum: branch[enumId] }));
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

  // Check if there are any removed values or other complex changes
  // Since we cannot reliably detect renames, we fall back to replace for any complex changes
  const removedValues = Array.from(mainLabelMap.keys()).filter(
    (label) => !branchLabelMap.has(label),
  );

  // Also check if sort orders have changed (which would require reordering)
  const hasSortOrderChanges = mainEnum.labels.some((mainLabel) => {
    const branchLabel = branchEnum.labels.find(
      (bl) => bl.label === mainLabel.label,
    );
    return branchLabel && branchLabel.sort_order !== mainLabel.sort_order;
  });

  const hasComplexChanges =
    removedValues.length > 0 ||
    hasSortOrderChanges ||
    mainEnum.labels.length !== branchEnum.labels.length;

  if (hasComplexChanges && addedValues.length === 0) {
    // If there are complex changes that can't be handled by simple ADD VALUE,
    // fall back to replace
    changes.push(new ReplaceEnum({ main: mainEnum, branch: branchEnum }));
  }

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
