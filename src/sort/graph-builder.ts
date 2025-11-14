import type { Change } from "../change.types.ts";
import type { GraphData, PgDependRow, PhaseSortOptions } from "./types.ts";

/**
 * Filter out dependency rows with "unknown:" prefixed stable IDs.
 *
 * The "unknown:" prefix indicates dependencies that cannot be resolved to stable IDs,
 * typically because the referenced or dependent object doesn't exist in the catalog
 * or cannot be uniquely identified. These are filtered out because they cannot be
 * reliably used for ordering.
 */
function filterUnknownDependencies(
  dependencyRows: PgDependRow[],
): PgDependRow[] {
  return dependencyRows.filter(
    (dependencyRow) =>
      !dependencyRow.referenced_stable_id.startsWith("unknown:") &&
      !dependencyRow.dependent_stable_id.startsWith("unknown:"),
  );
}

/**
 * Build the graph data structures from phase changes and dependency rows.
 */
export function buildGraphData(
  phaseChanges: Change[],
  dependencyRows: PgDependRow[],
  options: PhaseSortOptions,
): GraphData {
  const filteredDependencyRows = filterUnknownDependencies(dependencyRows);

  // Build map of referenced_id -> set of dependent_ids (from pg_depend)
  // Used for debug visualization and understanding dependency relationships
  const dependenciesByReferencedId = new Map<string, Set<string>>();
  for (const dependencyRow of filteredDependencyRows) {
    let dependentIds = dependenciesByReferencedId.get(
      dependencyRow.referenced_stable_id,
    );
    if (!dependentIds) {
      dependentIds = new Set<string>();
      dependenciesByReferencedId.set(
        dependencyRow.referenced_stable_id,
        dependentIds,
      );
    }
    dependentIds.add(dependencyRow.dependent_stable_id);
  }

  // For each change, collect the stable IDs it creates.
  // In DROP phase (invert=true), we also include dropped IDs since drops
  // need to be ordered based on what they remove.
  const createdStableIdSets: Array<Set<string>> = phaseChanges.map(
    (changeItem) => {
      const createdIds = new Set<string>(changeItem.creates);
      if (options.invert) {
        for (const droppedId of changeItem.drops ?? []) {
          createdIds.add(droppedId);
        }
      }
      return createdIds;
    },
  );

  // For each change, collect the stable IDs it explicitly requires.
  const explicitRequirementSets: Array<Set<string>> = phaseChanges.map(
    (changeItem) => new Set<string>(changeItem.requires ?? []),
  );

  // Track all requirements (explicit + inferred from pg_depend).
  // This starts as a copy of explicit requirements and will be extended
  // as we process pg_depend rows.
  const requirementSets: Array<Set<string>> = explicitRequirementSets.map(
    (explicitRequirements) => new Set<string>(explicitRequirements),
  );

  // Build reverse index: stable_id -> set of change indices that create it
  const changeIndexesByCreatedId = new Map<string, Set<number>>();
  for (let changeIndex = 0; changeIndex < phaseChanges.length; changeIndex++) {
    for (const createdId of createdStableIdSets[changeIndex]) {
      let producerIndexes = changeIndexesByCreatedId.get(createdId);
      if (!producerIndexes) {
        producerIndexes = new Set<number>();
        changeIndexesByCreatedId.set(createdId, producerIndexes);
      }
      producerIndexes.add(changeIndex);
    }
  }

  // Build reverse index: stable_id -> set of change indices that explicitly require it
  const changeIndexesByExplicitRequirementId = new Map<string, Set<number>>();
  for (
    let changeIndex = 0;
    changeIndex < explicitRequirementSets.length;
    changeIndex++
  ) {
    for (const requiredId of explicitRequirementSets[changeIndex]) {
      let consumerIndexes =
        changeIndexesByExplicitRequirementId.get(requiredId);
      if (!consumerIndexes) {
        consumerIndexes = new Set<number>();
        changeIndexesByExplicitRequirementId.set(requiredId, consumerIndexes);
      }
      consumerIndexes.add(changeIndex);
    }
  }

  return {
    createdStableIdSets,
    explicitRequirementSets,
    requirementSets,
    changeIndexesByCreatedId,
    changeIndexesByExplicitRequirementId,
    dependenciesByReferencedId,
  };
}

/**
 * Find all change indices that could be consumers for a given dependent stable ID.
 *
 * A consumer is either:
 * 1. A change that explicitly requires the dependent ID, OR
 * 2. A change that creates the dependent ID (since creating something implies
 *    it depends on its own dependencies)
 */
function findConsumerIndexes(
  dependentStableId: string,
  graphData: GraphData,
): Set<number> {
  const consumerIndexes = new Set<number>();

  // Add changes that explicitly require this ID
  const explicitConsumerIndexes =
    graphData.changeIndexesByExplicitRequirementId.get(dependentStableId);
  if (explicitConsumerIndexes) {
    for (const consumerIndex of explicitConsumerIndexes) {
      consumerIndexes.add(consumerIndex);
    }
  }

  // Add changes that create this ID (they are consumers of dependencies)
  const dependentProducers =
    graphData.changeIndexesByCreatedId.get(dependentStableId);
  if (dependentProducers) {
    for (const producerIndex of dependentProducers) {
      consumerIndexes.add(producerIndex);
    }
  }

  return consumerIndexes;
}

/**
 * Check if a dependency row represents a sequence ownership dependency that should be filtered out.
 *
 * When a sequence is owned by a table column that also uses the sequence (via DEFAULT),
 * pg_depend creates a cycle:
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
 * @param dependencyRow - The dependency row to check
 * @param phaseChanges - All changes in the current phase
 * @param graphData - Graph data structures for finding consumers
 * @returns true if this dependency should be filtered out (skipped)
 */
function shouldFilterSequenceOwnershipDependency(
  dependencyRow: PgDependRow,
  phaseChanges: Change[],
  graphData: GraphData,
): boolean {
  // Pattern match: sequence → table/column
  if (
    !dependencyRow.dependent_stable_id.startsWith("sequence:") ||
    (!dependencyRow.referenced_stable_id.startsWith("table:") &&
      !dependencyRow.referenced_stable_id.startsWith("column:"))
  ) {
    return false;
  }

  // Verify this is actually an ownership dependency by checking if any change
  // (create or drop) involving this sequence has ownership matching the referenced ID.
  const sequenceConsumers = findConsumerIndexes(
    dependencyRow.dependent_stable_id,
    graphData,
  );

  for (const consumerIndex of sequenceConsumers) {
    const consumerChange = phaseChanges[consumerIndex];
    // Check if this is a sequence change (create or drop) with ownership matching the referenced ID
    if (
      consumerChange.objectType === "sequence" &&
      "sequence" in consumerChange
    ) {
      const seq = consumerChange.sequence;
      if (seq.owned_by_schema && seq.owned_by_table && seq.owned_by_column) {
        const ownedByTableId = `table:${seq.owned_by_schema}.${seq.owned_by_table}`;
        const ownedByColumnId = `column:${seq.owned_by_schema}.${seq.owned_by_table}.${seq.owned_by_column}`;
        if (
          dependencyRow.referenced_stable_id === ownedByTableId ||
          dependencyRow.referenced_stable_id === ownedByColumnId
        ) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Build edges from pg_depend catalog rows.
 *
 * For each dependency row, we:
 * 1. Filter out cycle-breaking dependencies (e.g., sequence ownership)
 * 2. Find producers that create the referenced ID
 * 3. Find consumers that depend on the dependent ID
 * 4. Add edges from producers to consumers
 */
export function buildEdgesFromCatalogDependencies(
  dependencyRows: PgDependRow[],
  phaseChanges: Change[],
  graphData: GraphData,
  registerEdge: (sourceIndex: number, targetIndex: number) => void,
): void {
  const filteredDependencyRows = filterUnknownDependencies(dependencyRows);
  for (const dependencyRow of filteredDependencyRows) {
    // Filter out sequence ownership dependencies to prevent cycles
    if (
      shouldFilterSequenceOwnershipDependency(
        dependencyRow,
        phaseChanges,
        graphData,
      )
    ) {
      continue;
    }
    const referencedProducers = graphData.changeIndexesByCreatedId.get(
      dependencyRow.referenced_stable_id,
    );
    if (!referencedProducers || referencedProducers.size === 0) continue;

    const consumerIndexes = findConsumerIndexes(
      dependencyRow.dependent_stable_id,
      graphData,
    );
    if (consumerIndexes.size === 0) continue;

    for (const consumerIndex of consumerIndexes) {
      // All dependencies are accepted (cycle-breaking filters are applied earlier)

      // Track that this consumer requires the referenced ID
      graphData.requirementSets[consumerIndex].add(
        dependencyRow.referenced_stable_id,
      );

      // Add edges from all producers to this consumer
      for (const producerIndex of referencedProducers) {
        registerEdge(producerIndex, consumerIndex);
      }
    }
  }
}

/**
 * Build edges from explicit creates/requires relationships.
 *
 * This handles cases where dependencies aren't in pg_depend (e.g., privileges
 * computed from default privileges that don't exist in the database yet).
 * We iterate through explicitRequirementSets to ensure we catch all explicit
 * requirements, not just those that were also in pg_depend.
 */
export function buildEdgesFromExplicitRequirements(
  phaseChanges: Change[],
  graphData: GraphData,
  registerEdge: (sourceIndex: number, targetIndex: number) => void,
): void {
  for (
    let consumerIndex = 0;
    consumerIndex < phaseChanges.length;
    consumerIndex++
  ) {
    for (const requiredId of graphData.explicitRequirementSets[consumerIndex]) {
      const producerIndexes =
        graphData.changeIndexesByCreatedId.get(requiredId);
      if (!producerIndexes) continue;

      for (const producerIndex of producerIndexes) {
        if (producerIndex === consumerIndex) continue;

        // All explicit requirements are accepted (cycle-breaking filters are applied earlier)
        registerEdge(producerIndex, consumerIndex);
      }
    }
  }
}
