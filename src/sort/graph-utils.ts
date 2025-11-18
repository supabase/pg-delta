import type { Edge } from "./types.ts";

/**
 * Find all change indices that could be consumers for a given dependent stable ID.
 *
 * A consumer is either:
 * 1. A change that explicitly requires the dependent ID, OR
 * 2. A change that creates the dependent ID (since creating something implies
 *    it depends on its own dependencies)
 */
export function findConsumerIndexes(
  dependentStableId: string,
  changeIndexesByCreatedId: Map<string, Set<number>>,
  changeIndexesByExplicitRequirementId: Map<string, Set<number>>,
): Set<number> {
  const consumerIndexes = new Set<number>();

  // Add changes that explicitly require this ID
  const explicitConsumerIndexes =
    changeIndexesByExplicitRequirementId.get(dependentStableId);
  if (explicitConsumerIndexes) {
    for (const consumerIndex of explicitConsumerIndexes) {
      consumerIndexes.add(consumerIndex);
    }
  }

  // Add changes that create this ID (they are consumers of dependencies)
  const dependentProducers = changeIndexesByCreatedId.get(dependentStableId);
  if (dependentProducers) {
    for (const producerIndex of dependentProducers) {
      consumerIndexes.add(producerIndex);
    }
  }

  return consumerIndexes;
}

/**
 * Deduplicate edges, keeping the first occurrence.
 */
export function dedupeEdges(edges: Edge[]): Edge[] {
  const seenEdges = new Set<string>();
  const uniqueEdges: Edge[] = [];
  for (const edge of edges) {
    const edgeKey = `${edge.sourceIndex}->${edge.targetIndex}`;
    if (seenEdges.has(edgeKey)) continue;
    seenEdges.add(edgeKey);
    uniqueEdges.push(edge);
  }
  return uniqueEdges;
}
