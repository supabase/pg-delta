import type { Change } from "../change.types.ts";
import type { ConstraintSpec, Edge, UnifiedDependency } from "./types.ts";

/**
 * Predicate for selecting changes targeted by a constraint spec.
 */
type ChangeFilter =
  | Partial<Pick<Change, "operation" | "objectType" | "scope">>
  | ((change: Change) => boolean);

/**
 * Convert constraint specs to unified dependencies.
 *
 * This converts constraint specs (which define change-to-change ordering) into
 * the unified dependency format so they can be processed alongside stable ID dependencies.
 *
 * The algorithm:
 * - Select the items via spec.filter (or all items if not provided)
 * - Optionally partition by spec.groupBy, then apply edges within each group
 * - buildEdges can provide explicit edges; pairwise can declare local ordering
 */
export function convertConstraintSpecsToUnifiedDependencies(
  items: Change[],
  specs: ConstraintSpec<Change>[],
): UnifiedDependency[] {
  const globalIndexByChange = new Map<Change, number>();
  for (let changeIndex = 0; changeIndex < items.length; changeIndex++) {
    globalIndexByChange.set(items[changeIndex], changeIndex);
  }

  const dependencies: UnifiedDependency[] = [];
  for (const spec of specs) {
    const filteredItems = items.filter((changeItem) =>
      changeMatchesFilter(changeItem, spec.filter),
    );
    if (filteredItems.length === 0) continue;

    // If no groupBy is specified, treat all filtered items as a single group.
    // We use a sentinel key since the algorithm iterates over groups.
    const groupedItems = spec.groupBy
      ? groupChangesByKey(filteredItems, spec.groupBy)
      : new Map<string, Change[]>([["__all__", filteredItems]]);

    for (const groupItems of groupedItems.values()) {
      if (groupItems.length <= 1) continue;
      if (spec.buildEdges) {
        for (const edge of spec.buildEdges(groupItems)) {
          addDependencyFromSpec(
            edge,
            groupItems,
            globalIndexByChange,
            dependencies,
          );
        }
      }

      if (spec.pairwise) {
        for (let leftIndex = 0; leftIndex < groupItems.length; leftIndex++) {
          for (
            let rightIndex = 0;
            rightIndex < groupItems.length;
            rightIndex++
          ) {
            if (leftIndex === rightIndex) continue;
            const decision = spec.pairwise(
              groupItems[leftIndex],
              groupItems[rightIndex],
            );
            if (!decision) continue;
            const sourceIndex = globalIndexByChange.get(groupItems[leftIndex]);
            const targetIndex = globalIndexByChange.get(groupItems[rightIndex]);
            if (
              sourceIndex === undefined ||
              targetIndex === undefined ||
              sourceIndex === targetIndex
            ) {
              continue;
            }
            dependencies.push({
              type: "change",
              dependent_index:
                decision === "a_before_b" ? sourceIndex : targetIndex,
              referenced_index:
                decision === "a_before_b" ? targetIndex : sourceIndex,
              source: "constraint",
            });
          }
        }
      }
    }
  }
  return dependencies;
}

/**
 * Add a dependency from a constraint spec edge to the unified dependencies array.
 */
function addDependencyFromSpec(
  edge: Edge<Change>,
  groupItems: Change[],
  globalIndexByChange: Map<Change, number>,
  dependencies: UnifiedDependency[],
): void {
  let sourceIndex: number | undefined;
  let targetIndex: number | undefined;

  if (Array.isArray(edge)) {
    const [sourceLocalIndex, targetLocalIndex] = edge;
    sourceIndex = globalIndexByChange.get(groupItems[sourceLocalIndex]);
    targetIndex = globalIndexByChange.get(groupItems[targetLocalIndex]);
  } else {
    sourceIndex = globalIndexByChange.get(edge.from);
    targetIndex = globalIndexByChange.get(edge.to);
  }

  if (
    sourceIndex !== undefined &&
    targetIndex !== undefined &&
    sourceIndex !== targetIndex
  ) {
    dependencies.push({
      type: "change",
      dependent_index: sourceIndex,
      referenced_index: targetIndex,
      source: "constraint",
    });
  }
}

/** Matches a change against a filter (object or predicate). */
function changeMatchesFilter(change: Change, filter?: ChangeFilter): boolean {
  if (!filter) return true;
  if (typeof filter === "function") return filter(change);
  if (filter.operation !== undefined && change.operation !== filter.operation)
    return false;
  if (
    filter.objectType !== undefined &&
    change.objectType !== filter.objectType
  ) {
    return false;
  }
  if (filter.scope !== undefined && change.scope !== filter.scope) return false;
  return true;
}

/** Groups items by a key function (undefined/null map to a sentinel bucket). */
function groupChangesByKey<TItem>(
  items: TItem[],
  keySelector: (item: TItem) => string | null | undefined,
) {
  const groupedItems = new Map<string, TItem[]>();
  for (const item of items) {
    // Map null/undefined keys to a sentinel value since Map keys must be strings
    const bucketKey = keySelector(item) ?? "__null__";
    const existingBucket = groupedItems.get(bucketKey);
    if (existingBucket) {
      existingBucket.push(item);
    } else {
      groupedItems.set(bucketKey, [item]);
    }
  }
  return groupedItems;
}
