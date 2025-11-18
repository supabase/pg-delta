import type { Change } from "../change.types.ts";
import { CreateSequence } from "../objects/sequence/changes/sequence.create.ts";
import { stableId } from "../objects/utils.ts";
import { findConsumerIndexes } from "./graph-utils.ts";
import type { GraphData, PgDependRow } from "./types.ts";

/**
 * Check if a sequence is owned by a given table or column.
 */
function isSequenceOwnedBy(
  sequence: {
    owned_by_schema: string | null;
    owned_by_table: string | null;
    owned_by_column: string | null;
  },
  referencedStableId: string,
): boolean {
  if (
    !sequence.owned_by_schema ||
    !sequence.owned_by_table ||
    !sequence.owned_by_column
  ) {
    return false;
  }

  const ownedByTableId = stableId.table(
    sequence.owned_by_schema,
    sequence.owned_by_table,
  );
  const ownedByColumnId = stableId.column(
    sequence.owned_by_schema,
    sequence.owned_by_table,
    sequence.owned_by_column,
  );

  return (
    referencedStableId === ownedByTableId ||
    referencedStableId === ownedByColumnId
  );
}

/**
 * Check if a sequence ownership dependency should be filtered to prevent cycles.
 *
 * When a sequence is owned by a table column that also uses the sequence (via DEFAULT),
 * pg_depend creates a cycle:
 * - sequence → table/column (ownership)
 * - table/column → sequence (column default)
 *
 * We filter out the ownership dependency because:
 * - CREATE phase: sequences should be created before tables (ownership set via ALTER SEQUENCE OWNED BY after both exist)
 * - DROP phase: prevents cycles when dropping sequences owned by tables that aren't being dropped
 */
function shouldFilterSequenceOwnershipDependency(
  dependentStableId: string,
  referencedStableId: string,
  phaseChanges: Change[],
  graphData: GraphData,
): boolean {
  if (
    !dependentStableId.startsWith("sequence:") ||
    (!referencedStableId.startsWith("table:") &&
      !referencedStableId.startsWith("column:"))
  ) {
    return false;
  }

  const sequenceConsumers = findConsumerIndexes(
    dependentStableId,
    graphData.changeIndexesByCreatedId,
    graphData.changeIndexesByExplicitRequirementId,
  );

  for (const consumerIndex of sequenceConsumers) {
    const change = phaseChanges[consumerIndex];
    // Only filter CreateSequence, not AlterSequenceSetOwnedBy
    if (!(change instanceof CreateSequence)) {
      continue;
    }

    if (isSequenceOwnedBy(change.sequence, referencedStableId)) {
      return true;
    }
  }

  return false;
}

/**
 * Cycle-breaking filters for stable ID dependencies.
 *
 * Prevents cycles that would occur due to special PostgreSQL behaviors.
 * Delegates to specific filter functions for each type of cycle.
 */
export function shouldFilterStableIdDependencyForCycleBreaking(
  dependentStableId: string,
  referencedStableId: string,
  phaseChanges: Change[],
  graphData: GraphData,
): boolean {
  if (
    shouldFilterSequenceOwnershipDependency(
      dependentStableId,
      referencedStableId,
      phaseChanges,
      graphData,
    )
  ) {
    return true;
  }

  return false;
}

/**
 * Filter catalog dependencies before converting to Constraints.
 *
 * Filters out unknown stable IDs and applies cycle-breaking filters.
 */
export function filterCatalogDependencies(
  dependencyRows: PgDependRow[],
  phaseChanges: Change[],
  graphData: GraphData,
): PgDependRow[] {
  return dependencyRows.filter((row) => {
    if (
      row.referenced_stable_id.startsWith("unknown:") ||
      row.dependent_stable_id.startsWith("unknown:")
    ) {
      return false;
    }

    if (
      shouldFilterStableIdDependencyForCycleBreaking(
        row.dependent_stable_id,
        row.referenced_stable_id,
        phaseChanges,
        graphData,
      )
    ) {
      return false;
    }

    return true;
  });
}
