import type { Change } from "../change.types.ts";
import { CreateSequence } from "../objects/sequence/changes/sequence.create.ts";
import { stableId } from "../objects/utils.ts";
import { findConsumerIndexes } from "./graph-utils.ts";
import type { Dependency, GraphData } from "./types.ts";

/**
 * Check if a sequence is owned by a given table or column.
 *
 * This is used to identify sequence ownership dependencies that should be filtered
 * to prevent cycles when sequences are used by table columns (SERIAL columns).
 *
 * @param sequence - The sequence object to check
 * @param referencedStableId - The stable ID being referenced (table or column)
 * @returns true if the sequence is owned by the referenced table/column
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
 * Check if a sequence ownership dependency should be filtered out to prevent cycles.
 *
 * When a sequence is owned by a table column that also uses the sequence (via DEFAULT),
 * this creates a cycle:
 * - sequence → table/column (ownership)
 * - table/column → sequence (column default)
 *
 * This cycle would occur in both CREATE and DROP phases:
 * - CREATE: sequence → table (ownership) and table → sequence (column default)
 * - DROP (inverted): table → sequence (ownership) and sequence → table (column default)
 *
 * We filter out the ownership dependency because:
 * - CREATE phase: sequences should be created before tables (ownership set via ALTER SEQUENCE OWNED BY after both exist)
 * - DROP phase: prevents cycles when dropping sequences owned by tables that aren't being dropped
 *
 * Note: We only filter CreateSequence, not AlterSequenceSetOwnedBy, because the ALTER
 * needs to wait for the table/column to exist before it can set OWNED BY.
 *
 * @param sequenceStableId - The stable ID of the sequence (dependent)
 * @param referencedStableId - The stable ID being referenced (table or column)
 * @param phaseChanges - All changes in the current phase
 * @param graphData - Graph data structures for finding consumers
 * @returns true if this dependency should be filtered out (skipped)
 */
function shouldFilterSequenceOwnershipDependency(
  sequenceStableId: string,
  referencedStableId: string,
  phaseChanges: Change[],
  graphData: GraphData,
): boolean {
  // Pattern match: sequence → table/column
  if (
    !sequenceStableId.startsWith("sequence:") ||
    (!referencedStableId.startsWith("table:") &&
      !referencedStableId.startsWith("column:"))
  ) {
    return false;
  }

  // Find all consumers of the sequence and check if any match
  const sequenceConsumers = findConsumerIndexes(
    sequenceStableId,
    graphData.changeIndexesByCreatedId,
    graphData.changeIndexesByExplicitRequirementId,
  );

  for (const consumerIndex of sequenceConsumers) {
    const change = phaseChanges[consumerIndex];
    // Only filter CreateSequence, not AlterSequenceSetOwnedBy
    if (!(change instanceof CreateSequence)) {
      continue;
    }

    // Check if the sequence change has ownership matching the referenced ID
    if (isSequenceOwnedBy(change.sequence, referencedStableId)) {
      return true;
    }
  }

  return false;
}

/**
 * Filter out dependencies that should not be processed.
 *
 * This applies all filtering logic:
 * - Unknown dependencies (with "unknown:" prefix)
 * - Sequence ownership dependencies (to prevent cycles)
 * - Any other filters as needed
 *
 * @param dependencies - The dependencies to filter
 * @param phaseChanges - All changes in the current phase
 * @param graphData - Graph data structures for finding consumers
 * @returns Filtered dependencies that should be processed
 */
export function filterDependencies(
  dependencies: Dependency[],
  phaseChanges: Change[],
  graphData: GraphData,
): Dependency[] {
  return dependencies.filter((dependency) => {
    // Filter out unknown dependencies
    if (
      dependency.referenced_stable_id.startsWith("unknown:") ||
      dependency.dependent_stable_id.startsWith("unknown:")
    ) {
      return false;
    }

    // Filter out sequence ownership dependencies to prevent cycles
    if (
      shouldFilterSequenceOwnershipDependency(
        dependency.dependent_stable_id,
        dependency.referenced_stable_id,
        phaseChanges,
        graphData,
      )
    ) {
      return false;
    }

    return true;
  });
}
