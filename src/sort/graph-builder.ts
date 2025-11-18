import type { Change } from "../change.types.ts";
import { findConsumerIndexes } from "./graph-utils.ts";
import type {
  EdgeBuildingContext,
  GraphData,
  PgDependRow,
  PhaseSortOptions,
  UnifiedDependency,
} from "./types.ts";

/**
 * Convert catalog dependencies (PgDependRow) to unified dependencies.
 */
export function convertCatalogDependencies(
  dependencyRows: PgDependRow[],
): UnifiedDependency[] {
  return dependencyRows.map((row) => ({
    type: "stable_id",
    dependent_stable_id: row.dependent_stable_id,
    referenced_stable_id: row.referenced_stable_id,
    source: "catalog" as const,
  }));
}

/**
 * Convert explicit requirements to unified dependencies.
 *
 * For each change that explicitly requires something:
 * - If the change creates stable IDs, we create dependencies from each created ID to each required ID
 * - If the change doesn't create anything but requires something, we skip creating dependencies here
 *   because these are handled directly in buildEdgesFromUnifiedDependencies by iterating over changes
 *   and their requirements (via changeIndexesByExplicitRequirementId)
 *
 * Requires the change sets to be built first (via buildGraphData or separately).
 */
export function convertExplicitRequirements(
  phaseChanges: Change[],
  createdStableIdSets: Array<Set<string>>,
  explicitRequirementSets: Array<Set<string>>,
): UnifiedDependency[] {
  const dependencies: UnifiedDependency[] = [];

  for (
    let consumerIndex = 0;
    consumerIndex < phaseChanges.length;
    consumerIndex++
  ) {
    const createdIds = createdStableIdSets[consumerIndex];
    const requiredIds = explicitRequirementSets[consumerIndex];

    if (requiredIds.size === 0) continue;

    // Only create dependencies for changes that create stable IDs
    // Changes that don't create anything are handled directly in buildEdgesFromUnifiedDependencies
    if (createdIds.size > 0) {
      for (const requiredId of requiredIds) {
        for (const createdId of createdIds) {
          dependencies.push({
            type: "stable_id",
            dependent_stable_id: createdId,
            referenced_stable_id: requiredId,
            source: "explicit" as const,
          });
        }
      }
    }
  }

  return dependencies;
}

/**
 * Build the graph data structures from phase changes.
 *
 * This builds the full graph data including:
 * - Change sets (createdStableIdSets and explicitRequirementSets) from changes
 * - Reverse indexes needed for building edges (changeIndexesByCreatedId and changeIndexesByExplicitRequirementId)
 */
export function buildGraphData(
  phaseChanges: Change[],
  options: PhaseSortOptions,
): GraphData {
  // Build change sets (created and required IDs) from changes
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

  const explicitRequirementSets: Array<Set<string>> = phaseChanges.map(
    (changeItem) => new Set<string>(changeItem.requires ?? []),
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
    changeIndexesByCreatedId,
    changeIndexesByExplicitRequirementId,
  };
}

/**
 * Add edges from producers to consumers for a given requirement.
 *
 * This helper function:
 * 1. Finds all changes that create the required stable ID (producers)
 * 2. Finds all changes that need the required stable ID (consumers)
 * 3. Creates edges: producer → consumer (ensuring producers run before consumers)
 *
 * Example:
 *   If CreateTable requires role:admin, and CreateRole creates role:admin:
 *   CreateRole (producer) → CreateTable (consumer)
 */
function addEdgesForRequirement(
  requiredId: string,
  consumerIndexes: Set<number>,
  changeIndexesByCreatedId: Map<string, Set<number>>,
  registerEdge: (sourceIndex: number, targetIndex: number) => void,
): void {
  // Find all changes that create the required ID (producers)
  const producerIndexes = changeIndexesByCreatedId.get(requiredId);
  if (!producerIndexes || producerIndexes.size === 0) return;

  // For each consumer, add edges from all producers
  for (const consumerIndex of consumerIndexes) {
    // Create edges: producer → consumer
    for (const producerIndex of producerIndexes) {
      if (producerIndex === consumerIndex) continue; // Skip self-loops
      registerEdge(producerIndex, consumerIndex);
    }
  }
}

/**
 * Build edges from unified dependencies.
 *
 * This function converts unified dependencies (stable ID dependencies and change-to-change constraints)
 * into graph edges. It handles:
 *
 * 1. Stable ID dependencies: Converts them to edges by finding producers and consumers
 * 2. Change-to-change constraints: Directly converts them to edges
 *
 * For stable ID dependencies, there are two cases:
 *
 * CASE 1: Dependencies where the dependent_stable_id is something that gets created
 * ---------------------------------------------------------------------------------
 * Example: CreateTable creates table:public.users and requires role:admin
 *   Dependency: table:public.users → role:admin
 *   Producers of role:admin: [CreateRole]
 *   Consumers of table:public.users: [CreateTable] (found via findConsumerIndexes)
 *   Result: CreateRole → CreateTable
 *
 * CASE 2: Changes that don't create anything but require something
 * -----------------------------------------------------------------
 * Example: AlterSequenceSetOwnedBy requires sequence:public.seq and column:public.tbl.id
 *   This change doesn't create any stable IDs, so it doesn't appear in dependencies.
 *   We iterate directly over changes and their requirements.
 */
export function buildEdgesFromUnifiedDependencies(
  context: EdgeBuildingContext,
  filteredDependencies: UnifiedDependency[],
  phaseChanges: Change[],
): void {
  // Separate stable ID dependencies from change-to-change constraints
  const stableIdDependencies: Array<
    Extract<UnifiedDependency, { type: "stable_id" }>
  > = [];
  const changeConstraints: Array<
    Extract<UnifiedDependency, { type: "change" }>
  > = [];

  for (const dependency of filteredDependencies) {
    if (dependency.type === "change") {
      changeConstraints.push(dependency);
    } else {
      stableIdDependencies.push(dependency);
    }
  }

  // Process stable ID dependencies
  // CASE 1: Process dependencies where dependent_stable_id is something that gets created
  for (const dependency of stableIdDependencies) {
    // Find all changes that create the referenced ID (what's required)
    const producerIndexes = context.changeIndexesByCreatedId.get(
      dependency.referenced_stable_id,
    );
    if (!producerIndexes || producerIndexes.size === 0) continue;

    // Find all changes that depend on the dependent ID (changes that create or require it)
    const consumerIndexes = findConsumerIndexes(
      dependency.dependent_stable_id,
      context.changeIndexesByCreatedId,
      context.changeIndexesByExplicitRequirementId,
    );
    if (consumerIndexes.size === 0) continue;

    // Add edges: producer → consumer
    addEdgesForRequirement(
      dependency.referenced_stable_id,
      consumerIndexes,
      context.changeIndexesByCreatedId,
      context.registerEdge,
    );
  }

  // CASE 2: Handle changes that don't create anything but require something
  // These changes don't appear in dependencies because they have no created IDs to
  // use as dependent_stable_id. We iterate directly over changes and process their
  // requirements.
  for (
    let consumerIndex = 0;
    consumerIndex < phaseChanges.length;
    consumerIndex++
  ) {
    const createdIds = context.createdStableIdSets[consumerIndex];
    const requiredIds = context.explicitRequirementSets[consumerIndex];

    // Skip changes that create IDs (handled in CASE 1) or have no requirements
    if (createdIds.size > 0 || requiredIds.size === 0) continue;

    // For each requirement, find producers and add edges
    // The consumer is the change itself (since it doesn't create anything)
    const consumerIndexes = new Set<number>([consumerIndex]);
    for (const requiredId of requiredIds) {
      addEdgesForRequirement(
        requiredId,
        consumerIndexes,
        context.changeIndexesByCreatedId,
        context.registerEdge,
      );
    }
  }

  // Process change-to-change constraints (directly convert to edges)
  for (const constraint of changeConstraints) {
    if (constraint.type === "change") {
      context.registerEdge(
        constraint.dependent_index,
        constraint.referenced_index,
      );
    }
  }
}
