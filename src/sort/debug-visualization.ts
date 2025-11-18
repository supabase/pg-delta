import type { Change } from "../change.types.ts";
import { findCycle } from "./topological-sort.ts";
import type { Dependency, GraphData, PgDependRow } from "./types.ts";

/**
 * Generate a Mermaid diagram representation of the dependency graph for debugging.
 */
function generateMermaidDiagram(
  phaseChanges: Change[],
  graphData: GraphData,
  edges: Array<[number, number]>,
  requirementSets: Array<Set<string>>,
  dependenciesByReferencedId: Map<string, Set<string>>,
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
      requirementSets,
      dependenciesByReferencedId,
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
 * Build requirementSets from explicit requirements and dependencies (for debug visualization).
 *
 * This reconstructs what requirements were inferred from dependencies by looking at
 * the dependencies that were processed.
 */
function buildRequirementSets(
  explicitRequirementSets: Array<Set<string>>,
  dependencies: Dependency[],
  changeIndexesByCreatedId: Map<string, Set<number>>,
  changeIndexesByExplicitRequirementId: Map<string, Set<number>>,
): Array<Set<string>> {
  // Start with explicit requirements
  const requirementSets: Array<Set<string>> = explicitRequirementSets.map(
    (explicitRequirements) => new Set<string>(explicitRequirements),
  );

  // Add requirements inferred from dependencies
  // For each dependency, if the referenced ID is created by some change,
  // then the consumers of the dependent ID require the referenced ID
  for (const dependency of dependencies) {
    const referencedProducers = changeIndexesByCreatedId.get(
      dependency.referenced_stable_id,
    );
    if (!referencedProducers || referencedProducers.size === 0) continue;

    // Find consumers of the dependent ID (changes that create or require it)
    const consumers = new Set<number>();

    // Consumers that explicitly require the dependent ID
    const explicitConsumers = changeIndexesByExplicitRequirementId.get(
      dependency.dependent_stable_id,
    );
    if (explicitConsumers) {
      for (const idx of explicitConsumers) {
        consumers.add(idx);
      }
    }

    // Consumers that create the dependent ID
    const creatingConsumers = changeIndexesByCreatedId.get(
      dependency.dependent_stable_id,
    );
    if (creatingConsumers) {
      for (const idx of creatingConsumers) {
        consumers.add(idx);
      }
    }

    // Add the referenced ID to requirement sets of all consumers
    for (const consumerIndex of consumers) {
      requirementSets[consumerIndex].add(dependency.referenced_stable_id);
    }
  }

  return requirementSets;
}

/**
 * Build dependenciesByReferencedId from dependency rows (for debug visualization).
 */
function buildDependenciesByReferencedId(
  dependencyRows: PgDependRow[],
): Map<string, Set<string>> {
  const dependenciesByReferencedId = new Map<string, Set<string>>();
  for (const dependencyRow of dependencyRows) {
    // Filter out unknown dependencies
    if (
      dependencyRow.referenced_stable_id.startsWith("unknown:") ||
      dependencyRow.dependent_stable_id.startsWith("unknown:")
    ) {
      continue;
    }

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
  return dependenciesByReferencedId;
}

/**
 * Describe an edge in the dependency graph for visualization.
 */
function describeEdge(
  sourceIndex: number,
  targetIndex: number,
  graphData: GraphData,
  requirementSets: Array<Set<string>>,
  dependenciesByReferencedId: Map<string, Set<string>>,
): string {
  // Check if target explicitly requires something created by source
  for (const createdId of graphData.createdStableIdSets[sourceIndex]) {
    if (requirementSets[targetIndex].has(createdId)) {
      return `${createdId} -> (requires)`;
    }
  }

  // Check pg_depend relationships
  for (const createdId of graphData.createdStableIdSets[sourceIndex]) {
    const outgoingDependencies = dependenciesByReferencedId.get(createdId);
    if (!outgoingDependencies) continue;

    // Check if target requires this ID
    for (const requiredId of requirementSets[targetIndex]) {
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
 *
 * Builds debug-only data structures (requirementSets, dependenciesByReferencedId) just-in-time.
 */
export function printDebugGraph(
  phaseChanges: Change[],
  graphData: GraphData,
  edges: Array<[number, number]>,
  dependencyRows: PgDependRow[],
  dependencies: Dependency[],
): void {
  if (!process.env.GRAPH_DEBUG) return;

  try {
    // Build debug-only data structures just-in-time
    const requirementSets = buildRequirementSets(
      graphData.explicitRequirementSets,
      dependencies,
      graphData.changeIndexesByCreatedId,
      graphData.changeIndexesByExplicitRequirementId,
    );
    const dependenciesByReferencedId =
      buildDependenciesByReferencedId(dependencyRows);

    const mermaidDiagram = generateMermaidDiagram(
      phaseChanges,
      graphData,
      edges,
      requirementSets,
      dependenciesByReferencedId,
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
