import type { Change } from "../change.types.ts";
import {
  filterCatalogDependencies,
  shouldFilterStableIdDependencyForCycleBreaking,
} from "./dependency-filter.ts";
import { findConsumerIndexes } from "./graph-utils.ts";
import type {
  Constraint,
  GraphData,
  PgDependRow,
  PhaseSortOptions,
} from "./types.ts";

/**
 * Convert catalog dependencies to Constraints.
 *
 * For each catalog dependency (stable ID → stable ID), finds the changes that
 * create/require those stable IDs and creates Constraints between them.
 *
 * Filters out unknown stable IDs and applies cycle-breaking filters before conversion.
 */
export function convertCatalogDependenciesToConstraints(
  dependencyRows: PgDependRow[],
  phaseChanges: Change[],
  graphData: GraphData,
): Constraint[] {
  const filteredDependencies = filterCatalogDependencies(
    dependencyRows,
    phaseChanges,
    graphData,
  );

  const constraints: Constraint[] = [];

  for (const row of filteredDependencies) {
    const producerIndexes = graphData.changeIndexesByCreatedId.get(
      row.referenced_stable_id,
    );
    if (!producerIndexes || producerIndexes.size === 0) continue;

    const consumerIndexes = findConsumerIndexes(
      row.dependent_stable_id,
      graphData.changeIndexesByCreatedId,
      graphData.changeIndexesByExplicitRequirementId,
    );
    if (consumerIndexes.size === 0) continue;

    for (const producerIndex of producerIndexes) {
      for (const consumerIndex of consumerIndexes) {
        if (producerIndex === consumerIndex) continue;
        constraints.push({
          sourceChangeIndex: producerIndex,
          targetChangeIndex: consumerIndex,
          source: "catalog",
          reason: {
            dependentStableId: row.dependent_stable_id,
            referencedStableId: row.referenced_stable_id,
          },
        });
      }
    }
  }

  return constraints;
}

/**
 * Convert explicit requirements to Constraints.
 *
 * For each change that explicitly requires something:
 * - If the change creates stable IDs, creates Constraints from producers of required IDs to this change
 * - If the change doesn't create anything but requires something, creates Constraints from producers to this change
 *
 * Applies cycle-breaking filters during conversion for changes that create stable IDs.
 */
export function convertExplicitRequirementsToConstraints(
  phaseChanges: Change[],
  graphData: GraphData,
): Constraint[] {
  const constraints: Constraint[] = [];

  for (
    let consumerIndex = 0;
    consumerIndex < phaseChanges.length;
    consumerIndex++
  ) {
    const createdIds = graphData.createdStableIdSets[consumerIndex];
    const requiredIds = graphData.explicitRequirementSets[consumerIndex];

    if (requiredIds.size === 0) continue;

    for (const requiredId of requiredIds) {
      const producerIndexes =
        graphData.changeIndexesByCreatedId.get(requiredId);
      if (!producerIndexes || producerIndexes.size === 0) continue;

      if (createdIds.size > 0) {
        for (const createdId of createdIds) {
          if (
            shouldFilterStableIdDependencyForCycleBreaking(
              createdId,
              requiredId,
              phaseChanges,
              graphData,
            )
          ) {
            continue;
          }

          for (const producerIndex of producerIndexes) {
            if (producerIndex === consumerIndex) continue;
            constraints.push({
              sourceChangeIndex: producerIndex,
              targetChangeIndex: consumerIndex,
              source: "explicit",
              reason: {
                dependentStableId: createdId,
                referencedStableId: requiredId,
              },
            });
          }
        }
      } else {
        // Change doesn't create anything but requires something
        for (const producerIndex of producerIndexes) {
          if (producerIndex === consumerIndex) continue;
          constraints.push({
            sourceChangeIndex: producerIndex,
            targetChangeIndex: consumerIndex,
            source: "explicit",
            reason: {
              dependentStableId: "",
              referencedStableId: requiredId,
            },
          });
        }
      }
    }
  }

  return constraints;
}

/**
 * Build graph data structures from phase changes.
 *
 * Creates change sets and reverse indexes needed for converting dependencies to Constraints.
 * In DROP phase (invert=true), dropped IDs are included in createdStableIdSets.
 */
export function buildGraphData(
  phaseChanges: Change[],
  options: PhaseSortOptions,
): GraphData {
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
 * Convert Constraints to graph edges.
 */
export function convertConstraintsToEdges(
  constraints: Constraint[],
  registerEdge: (sourceIndex: number, targetIndex: number) => void,
): void {
  for (const constraint of constraints) {
    registerEdge(constraint.sourceChangeIndex, constraint.targetChangeIndex);
  }
}
