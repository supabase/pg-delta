import type { Change } from "../change.types.ts";
import { CreateSequence } from "../objects/sequence/changes/sequence.create.ts";
import { stableId } from "../objects/utils.ts";
import { findConsumerIndexes } from "./graph-utils.ts";
import type { Edge, GraphData } from "./types.ts";

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
function shouldFilterStableIdDependencyForCycleBreaking(
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
 * Identify edges that are part of a cycle.
 *
 * Given cycle node indices, returns edges where both source and target are in the cycle
 * and form consecutive nodes in the cycle path.
 */
export function getEdgesInCycle(
  cycleNodeIndexes: number[],
  edges: Edge[],
): Edge[] {
  const cycleEdges: Edge[] = [];

  // Create a map of edges for quick lookup
  const edgeMap = new Map<string, Edge>();
  for (const edge of edges) {
    const key = `${edge.sourceIndex}->${edge.targetIndex}`;
    edgeMap.set(key, edge);
  }

  // Find edges that connect consecutive nodes in the cycle
  for (let i = 0; i < cycleNodeIndexes.length; i++) {
    const sourceIndex = cycleNodeIndexes[i];
    const targetIndex = cycleNodeIndexes[(i + 1) % cycleNodeIndexes.length];
    const key = `${sourceIndex}->${targetIndex}`;
    const edge = edgeMap.get(key);
    if (edge) {
      cycleEdges.push(edge);
    }
  }

  return cycleEdges;
}

/**
 * Filter edges involved in cycles based on their constraint's cycle-breaking rules.
 *
 * This is applied when cycles are detected to break them by removing problematic edges.
 * Only filters edges that:
 * 1. Are part of the detected cycle(s)
 * 2. Have a reason (stable ID dependency) - custom constraints are never filtered
 * 3. Match the cycle-breaking filter criteria
 */
export function filterEdgesForCycleBreaking(
  edges: Edge[],
  cycleNodeIndexes: number[],
  phaseChanges: Change[],
  graphData: GraphData,
): Edge[] {
  // Get edges that are part of the cycle
  const cycleEdges = getEdgesInCycle(cycleNodeIndexes, edges);
  // Use string keys for comparison since Set.has() uses reference equality
  const cycleEdgeKeys = new Set(
    cycleEdges.map((e) => `${e.sourceIndex}->${e.targetIndex}`),
  );

  return edges.filter((edge) => {
    const edgeKey = `${edge.sourceIndex}->${edge.targetIndex}`;
    // If edge is not in the cycle, keep it
    if (!cycleEdgeKeys.has(edgeKey)) {
      return true;
    }

    // Edge is in cycle - check if it should be filtered
    const constraint = edge.constraint;

    // Custom constraints are never filtered
    if (constraint.source === "custom") return true;

    const { dependentStableId, referencedStableId } = constraint.reason;
    // Skip if dependentStableId is undefined (explicit requirement without created IDs)
    if (!dependentStableId) return true;

    // Apply cycle-breaking filters - return false to filter out this edge
    return !shouldFilterStableIdDependencyForCycleBreaking(
      dependentStableId,
      referencedStableId,
      phaseChanges,
      graphData,
    );
  });
}
