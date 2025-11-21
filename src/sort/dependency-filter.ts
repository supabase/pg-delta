import type { Change } from "../change.types.ts";
import { CreateSequence } from "../objects/sequence/changes/sequence.create.ts";
import { stableId } from "../objects/utils.ts";
import { findConsumerIndexes } from "./graph-utils.ts";
import type { Edge, GraphData } from "./types.ts";

/**
 * Check if a sequence is owned by a given column.
 *
 * @param sequence - The sequence object with ownership information
 * @param referencedStableId - The column stable ID to check against
 * @returns true if the sequence is owned by the referenced column
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

  const ownedByColumnId = stableId.column(
    sequence.owned_by_schema,
    sequence.owned_by_table,
    sequence.owned_by_column,
  );

  return referencedStableId === ownedByColumnId;
}

/**
 * Check if a sequence ownership dependency should be filtered to prevent cycles.
 *
 * CYCLE SCENARIO:
 * When a sequence is owned by a table column that also uses the sequence (via DEFAULT),
 * PostgreSQL's pg_depend creates a bidirectional dependency cycle:
 *   1. column → sequence (column default depends on sequence)
 *   2. sequence → column (sequence ownership depends on column)
 *
 * This creates: sequence → column → sequence (cycle!)
 *
 * HOW WE BREAK THE CYCLE:
 * We filter out the ownership dependency edge (sequence → column) because:
 *   - CREATE phase: Sequences should be created before tables. Ownership is set later
 *     via ALTER SEQUENCE OWNED BY after both the sequence and table exist.
 *   - DROP phase: Prevents cycles when dropping sequences owned by tables that
 *     aren't being dropped.
 *
 * PARAMETERS:
 * @param dependentStableId - The sequence stable ID (e.g., "sequence:schema.seq_name")
 * @param referencedStableId - The column stable ID (e.g., "column:schema.table.col")
 *   Note: PostgreSQL's pg_depend creates sequence ownership dependencies on columns (not tables)
 *   when refobjsubid > 0, so we only check for column dependencies
 * @param phaseChanges - All changes in the current phase
 * @param graphData - Graph data structures for looking up changes
 * @returns true if this ownership dependency should be filtered (removed) to break the cycle
 */
function shouldFilterSequenceOwnershipDependency(
  dependentStableId: string,
  referencedStableId: string,
  phaseChanges: Change[],
  graphData: GraphData,
): boolean {
  // Early exit: only filter edges FROM sequences TO columns
  // Note: PostgreSQL's pg_depend creates sequence ownership dependencies on columns (not tables)
  // when refobjsubid > 0, so we only need to check for column dependencies
  if (
    !dependentStableId.startsWith("sequence:") ||
    !referencedStableId.startsWith("column:")
  ) {
    return false;
  }

  // Find all changes that create or consume this sequence
  // (includes the CreateSequence change that creates it)
  const changesInvolvingSequence = findConsumerIndexes(
    dependentStableId,
    graphData.changeIndexesByCreatedId,
    graphData.changeIndexesByExplicitRequirementId,
  );

  // Check if any CreateSequence change creates a sequence that is owned by
  // the referenced table/column. If so, filter this ownership dependency edge.
  for (const changeIndex of changesInvolvingSequence) {
    const change = phaseChanges[changeIndex];

    // Only filter edges from CreateSequence changes, not AlterSequenceSetOwnedBy.
    // AlterSequenceSetOwnedBy is a separate change that sets ownership after
    // both the sequence and table exist, so it doesn't create the cycle.
    if (!(change instanceof CreateSequence)) {
      continue;
    }

    // Check if this CreateSequence creates a sequence owned by the referenced table/column
    if (isSequenceOwnedBy(change.sequence, referencedStableId)) {
      return true; // Filter this edge to break the cycle
    }
  }

  return false; // Don't filter - this is not a cycle-causing ownership dependency
}

/**
 * Cycle-breaking filters for stable ID dependencies.
 *
 * Prevents cycles that would occur due to special PostgreSQL behaviors.
 * Delegates to specific filter functions for each type of cycle.
 *
 * @param dependentStableId - The dependent object's stable ID
 * @param referencedStableId - The referenced object's stable ID
 * @param phaseChanges - All changes in the current phase
 * @param graphData - Graph data structures for looking up changes
 * @returns true if this dependency edge should be filtered (removed) to break a cycle
 */
function shouldFilterStableIdDependencyForCycleBreaking(
  dependentStableId: string,
  referencedStableId: string,
  phaseChanges: Change[],
  graphData: GraphData,
): boolean {
  // Filter sequence ownership dependencies that create cycles with column defaults
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
