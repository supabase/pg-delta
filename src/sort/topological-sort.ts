import type { Change } from "../change.types.ts";
import type { Constraint } from "./types.ts";

/**
 * Stable topological sort. If multiple zero-indegree nodes exist, picks the
 * smallest original index first to preserve input order among unconstrained items.
 * Returns null on cycles.
 */
export function performStableTopologicalSort(
  nodeCount: number,
  edges: Array<[number, number]>,
): number[] | null {
  const adjacencyList: Array<Set<number>> = Array.from(
    { length: nodeCount },
    () => new Set<number>(),
  );
  const inDegreeCounts = new Array<number>(nodeCount).fill(0);

  for (const [sourceIndex, targetIndex] of edges) {
    if (!adjacencyList[sourceIndex].has(targetIndex)) {
      adjacencyList[sourceIndex].add(targetIndex);
      inDegreeCounts[targetIndex]++;
    }
  }

  const candidateQueue: number[] = [];
  for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex++) {
    if (inDegreeCounts[nodeIndex] === 0) candidateQueue.push(nodeIndex);
  }
  candidateQueue.sort((left, right) => left - right);

  const orderedNodeIndexes: number[] = [];
  while (candidateQueue.length > 0) {
    const nodeIndex = candidateQueue.shift() as number;
    orderedNodeIndexes.push(nodeIndex);
    for (const neighborIndex of adjacencyList[nodeIndex]) {
      inDegreeCounts[neighborIndex]--;
      if (inDegreeCounts[neighborIndex] === 0) {
        let inserted = false;
        for (
          let queuePosition = 0;
          queuePosition < candidateQueue.length;
          queuePosition++
        ) {
          if (neighborIndex < candidateQueue[queuePosition]) {
            candidateQueue.splice(queuePosition, 0, neighborIndex);
            inserted = true;
            break;
          }
        }
        if (!inserted) candidateQueue.push(neighborIndex);
      }
    }
  }

  if (orderedNodeIndexes.length !== nodeCount) return null; // cycle detected
  return orderedNodeIndexes;
}

/**
 * Find one cycle (if any) and return its node indices in order.
 */
export function findCycle(
  nodeCount: number,
  edges: Array<[number, number]>,
): number[] | null {
  const adjacencyList: Array<number[]> = Array.from(
    { length: nodeCount },
    () => [],
  );
  for (const [sourceIndex, targetIndex] of edges) {
    adjacencyList[sourceIndex].push(targetIndex);
  }

  // 0 = unvisited, 1 = visiting, 2 = completed
  const visitState = new Array<number>(nodeCount).fill(0);
  const pathStack: number[] = [];
  let cycleNodeIndexes: number[] | null = null;

  const depthFirstSearch = (nodeIndex: number) => {
    if (cycleNodeIndexes) return;
    visitState[nodeIndex] = 1;
    pathStack.push(nodeIndex);

    for (const neighborIndex of adjacencyList[nodeIndex]) {
      if (visitState[neighborIndex] === 0) {
        depthFirstSearch(neighborIndex);
      } else if (visitState[neighborIndex] === 1) {
        const cycleStartIndex = pathStack.lastIndexOf(neighborIndex);
        if (cycleStartIndex !== -1) {
          cycleNodeIndexes = pathStack.slice(cycleStartIndex);
        }
        return;
      }
      if (cycleNodeIndexes) return;
    }

    pathStack.pop();
    visitState[nodeIndex] = 2;
  };

  for (
    let nodeIndex = 0;
    nodeIndex < nodeCount && !cycleNodeIndexes;
    nodeIndex++
  ) {
    if (visitState[nodeIndex] === 0) depthFirstSearch(nodeIndex);
  }

  return cycleNodeIndexes;
}

/**
 * Format a cycle error message with details about the changes involved and the edges forming the cycle.
 */
export function formatCycleError(
  cycleNodeIndexes: number[],
  phaseChanges: Change[],
  cycleEdges?: Array<{
    sourceIndex: number;
    targetIndex: number;
    constraint: Constraint;
  }>,
): string {
  const cycleChanges = cycleNodeIndexes.map((idx) => phaseChanges[idx]);
  const changeDescriptions = cycleChanges.map((change, i) => {
    const className = change?.constructor?.name ?? "Change";
    const creates = change.creates.slice(0, 2).join(", ");
    return `  ${i + 1}. [${cycleNodeIndexes[i]}] ${className}${creates ? ` (creates: ${creates}${change.creates.length > 2 ? "..." : ""})` : ""}`;
  });

  let message = `CycleError: dependency graph contains a cycle involving ${cycleNodeIndexes.length} changes:\n${changeDescriptions.join("\n")}`;

  // Add cycle path information if edges are provided
  if (cycleEdges && cycleEdges.length > 0) {
    message += `\n\nCycle path (edges forming the cycle):`;
    for (let i = 0; i < cycleNodeIndexes.length; i++) {
      const sourceIndex = cycleNodeIndexes[i];
      const targetIndex = cycleNodeIndexes[(i + 1) % cycleNodeIndexes.length];
      const edge = cycleEdges.find(
        (e) => e.sourceIndex === sourceIndex && e.targetIndex === targetIndex,
      );

      if (edge) {
        const constraint = edge.constraint;
        let edgeInfo = `\n  [${sourceIndex}] → [${targetIndex}] (source: ${constraint.source})`;

        if (
          constraint.source === "catalog" ||
          constraint.source === "explicit"
        ) {
          if (constraint.reason.dependentStableId) {
            edgeInfo += `\n    Dependency: ${constraint.reason.dependentStableId} → ${constraint.reason.referencedStableId}`;
          } else {
            edgeInfo += `\n    Requires: ${constraint.reason.referencedStableId}`;
          }
        }

        // Add why it wasn't filtered
        if (constraint.source === "custom") {
          edgeInfo += `\n    Reason: Custom constraint (never filtered)`;
        } else if (
          constraint.source === "explicit" &&
          !constraint.reason.dependentStableId
        ) {
          edgeInfo += `\n    Reason: Explicit requirement without created IDs (not filtered)`;
        } else {
          edgeInfo += `\n    Reason: Cycle-breaking filter did not match (edge preserved)`;
        }

        message += edgeInfo;
      } else {
        message += `\n  [${sourceIndex}] → [${targetIndex}] (edge not found)`;
      }
    }
  }

  message += `\n\nThis usually indicates a circular dependency in the schema changes that cannot be resolved.`;
  if (cycleEdges && cycleEdges.length > 0) {
    message += `\nThe cycle-breaking filters were unable to break this cycle.`;
  }

  return message;
}
