import type { Change } from "../change.types.ts";
import { findCycle } from "./topological-sort.ts";
import type { GraphData } from "./types.ts";

/**
 * Generate a Mermaid diagram representation of the dependency graph for debugging.
 */
function generateMermaidDiagram(
  phaseChanges: Change[],
  graphData: GraphData,
  edges: Array<[number, number]>,
): string {
  const cycleNodeIndexes = findCycle(phaseChanges.length, edges) ?? [];
  const mermaidLines: string[] = [];
  mermaidLines.push("flowchart TD");

  // Add nodes
  for (let changeIndex = 0; changeIndex < phaseChanges.length; changeIndex++) {
    const changeInstance = phaseChanges[changeIndex];
    const changeClassName = changeInstance?.constructor?.name ?? "Change";
    const truncatedCreates = Array.isArray(changeInstance.creates)
      ? changeInstance.creates.slice(0, 3)
      : [];
    const nodeLabel = `${changeIndex}: ${changeClassName} ${
      truncatedCreates.length > 0 ? `[${truncatedCreates.join(",")}]` : ""
    }`.replaceAll('"', "'");
    mermaidLines.push(`  n${changeIndex}["${nodeLabel}"]`);
  }

  // Add edges with descriptions
  for (const [sourceIndex, targetIndex] of edges) {
    const edgeDescription = describeEdge(
      sourceIndex,
      targetIndex,
      graphData,
    ).replaceAll('"', "'");
    if (edgeDescription.length > 0) {
      mermaidLines.push(
        `  n${sourceIndex} -- "${edgeDescription}" --> n${targetIndex}`,
      );
    } else {
      mermaidLines.push(`  n${sourceIndex} --> n${targetIndex}`);
    }
  }

  // Highlight cycles if any
  if (cycleNodeIndexes.length > 0) {
    mermaidLines.push(
      "  classDef cycleNode fill:#ffe6e6,stroke:#ff4d4f,stroke-width:2px;",
    );
    for (const nodeIndex of cycleNodeIndexes) {
      mermaidLines.push(`  class n${nodeIndex} cycleNode;`);
    }

    const cycleEdges: Array<[number, number]> = [];
    for (
      let cycleIndex = 0;
      cycleIndex < cycleNodeIndexes.length;
      cycleIndex++
    ) {
      const sourceIndex = cycleNodeIndexes[cycleIndex];
      const targetIndex =
        cycleNodeIndexes[(cycleIndex + 1) % cycleNodeIndexes.length];
      cycleEdges.push([sourceIndex, targetIndex]);
    }

    let edgeIndex = 0;
    for (const [sourceIndex, targetIndex] of edges) {
      const edgeBelongsToCycle = cycleEdges.some(
        ([cycleSourceIndex, cycleTargetIndex]) =>
          cycleSourceIndex === sourceIndex && cycleTargetIndex === targetIndex,
      );
      if (edgeBelongsToCycle) {
        mermaidLines.push(
          `  linkStyle ${edgeIndex} stroke:#ff4d4f,stroke-width:2px;`,
        );
      }
      edgeIndex++;
    }
  }

  return mermaidLines.join("\n");
}

/**
 * Describe an edge in the dependency graph for visualization.
 */
function describeEdge(
  sourceIndex: number,
  targetIndex: number,
  graphData: GraphData,
): string {
  // Check if target explicitly requires something created by source
  for (const createdId of graphData.createdStableIdSets[sourceIndex]) {
    if (graphData.requirementSets[targetIndex].has(createdId)) {
      return `${createdId} -> (requires)`;
    }
  }

  // Check pg_depend relationships
  for (const createdId of graphData.createdStableIdSets[sourceIndex]) {
    const outgoingDependencies =
      graphData.dependenciesByReferencedId.get(createdId);
    if (!outgoingDependencies) continue;

    // Check if target requires this ID
    for (const requiredId of graphData.requirementSets[targetIndex]) {
      if (outgoingDependencies.has(requiredId)) {
        return `${createdId} -> ${requiredId}`;
      }
    }

    // Check if target creates something that depends on this ID
    for (const targetCreatedId of graphData.createdStableIdSets[targetIndex]) {
      if (outgoingDependencies.has(targetCreatedId)) {
        return `${createdId} -> ${targetCreatedId}`;
      }
    }
  }

  return "";
}

/**
 * Print debug information about the dependency graph.
 */
export function printDebugGraph(
  phaseChanges: Change[],
  graphData: GraphData,
  edges: Array<[number, number]>,
): void {
  if (!process.env.GRAPH_DEBUG) return;

  try {
    const mermaidDiagram = generateMermaidDiagram(
      phaseChanges,
      graphData,
      edges,
    );
    // eslint-disable-next-line no-console
    console.log(
      [
        "\n==== Mermaid (cycle detected) ====",
        mermaidDiagram,
        "==== end ====",
      ].join("\n"),
    );
  } catch (_error) {
    // ignore debug printing errors
  }
}
