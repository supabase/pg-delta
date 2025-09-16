import type { Graph } from "graph-data-structure";
import { CycleError, topologicalSort } from "graph-data-structure";

interface Constraint {
  constraintStableId: string;
  reason?: string;
}
// Prepare stable edge list as we emit them (Mermaid linkStyle uses emission order)
type EdgeEntry = {
  fromSafe: string;
  toSafe: string;
  fromOrig: string;
  toOrig: string;
};

export function graphToMermaid(graph: Graph<string, Constraint>): string {
  const lines: string[] = ["flowchart TD"]; // Top-down layout
  const idMap = new Map<string, string>();
  let index = 0;

  // Build a deterministic order for nodes
  const orderedNodes = [...graph.nodes];

  // Declare nodes with safe identifiers and human-readable labels
  for (const nodeId of orderedNodes) {
    const safeId = `N${index++}`;
    idMap.set(nodeId, safeId);
    const raw = String(nodeId);
    const labelSource = raw.includes(":")
      ? raw.split(":").slice(1).join(":")
      : raw;
    const label = labelSource.replace(/"/g, '\\"').trim();
    lines.push(`  ${safeId}["${label}"]`);
  }

  const edges: EdgeEntry[] = [];

  for (const from of orderedNodes) {
    const fromId = idMap.get(from);
    if (!fromId) continue;
    for (const to of graph.adjacent(from) ?? []) {
      const toId = idMap.get(to);
      if (!toId) continue;

      // Get the constraint reason from the edge properties
      const edgeProps = graph.getEdgeProperties(from, to);
      const reason = edgeProps?.reason ? `"${edgeProps.reason}"` : "depends on";

      edges.push({
        fromSafe: fromId,
        toSafe: toId,
        fromOrig: from,
        toOrig: to,
      });
      lines.push(`  ${fromId} -->|${reason}| ${toId}`);
    }
  }

  // Use the library's built-in cycle detection to check if there are any cycles
  let hasCycles = false;
  try {
    topologicalSort(graph);
  } catch (error) {
    if (error instanceof CycleError) {
      hasCycles = true;
    } else {
      throw error;
    }
  }

  // If there are cycles, find strongly connected components (SCCs)
  if (hasCycles) {
    // Tarjan's algorithm for SCC detection
    const nodeToIndex = new Map<string, number>();
    const nodeToLow = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    let dfsIndex = 0;
    const sccs: string[][] = [];

    function strongConnect(v: string): void {
      nodeToIndex.set(v, dfsIndex);
      nodeToLow.set(v, dfsIndex);
      dfsIndex++;
      stack.push(v);
      onStack.add(v);

      for (const w of graph.adjacent(v) ?? []) {
        if (!nodeToIndex.has(w)) {
          strongConnect(w);
          // biome-ignore lint/style/noNonNullAssertion: nodeToLow is built from orderedNodes
          nodeToLow.set(v, Math.min(nodeToLow.get(v)!, nodeToLow.get(w)!));
        } else if (onStack.has(w)) {
          // biome-ignore lint/style/noNonNullAssertion: nodeToLow is built from orderedNodes
          nodeToLow.set(v, Math.min(nodeToLow.get(v)!, nodeToIndex.get(w)!));
        }
      }

      if (nodeToLow.get(v) === nodeToIndex.get(v)) {
        const comp: string[] = [];
        while (true) {
          const w = stack.pop();
          if (!w) break;
          onStack.delete(w);
          comp.push(w);
          if (w === v) break;
        }
        sccs.push(comp);
      }
    }

    for (const n of orderedNodes) {
      if (!nodeToIndex.has(n)) strongConnect(n);
    }

    // Create subgraph boxes for cyclic SCCs
    const sccPalette = [
      "#d33",
      "#37a",
      "#3a3",
      "#a63",
      "#a3a",
      "#07a",
      "#c83",
      "#579",
      "#5a5",
      "#999",
    ];
    let sccColorIdx = 0;

    const cyclicSccs: { id: string; members: string[]; color: string }[] = [];
    for (const comp of sccs) {
      const hasSelfLoop = (() => {
        if (comp.length !== 1) return false;
        const adj = graph.adjacent(comp[0]) ?? [];
        for (const w of adj as Iterable<string>) {
          if (w === comp[0]) return true;
        }
        return false;
      })();
      const isCyclic = comp.length > 1 || hasSelfLoop;
      if (!isCyclic) continue;

      const sccId = `SCC${cyclicSccs.length + 1}`;
      const color = sccPalette[sccColorIdx % sccPalette.length];
      sccColorIdx++;
      cyclicSccs.push({ id: sccId, members: comp, color });

      // Annotate subgraph with nodes
      lines.push(`  subgraph ${sccId}["Cycle group ${cyclicSccs.length}"]`);
      lines.push("    direction TB");
      for (const member of comp) {
        const safe = idMap.get(member);
        if (safe) lines.push(`    ${safe}`);
      }
      lines.push("  end");
      // Style the subgraph box
      lines.push(
        `  style ${sccId} fill:#fffbe6,stroke:${color},stroke-width:2px,stroke-dasharray: 5 3;`,
      );
    }

    // Now find and color cycles within each SCC
    const cyclePalette = [
      "#e41a1c",
      "#377eb8",
      "#4daf4a",
      "#984ea3",
      "#ff7f00",
      "#a65628",
      "#f781bf",
      "#999999",
      "#66c2a5",
      "#e78ac3",
    ];

    // Build index for ordering to avoid duplicate cycles
    const orderIndex = new Map<string, number>();
    for (let i = 0; i < orderedNodes.length; i++) {
      orderIndex.set(orderedNodes[i], i);
    }

    // Helper to get neighbors within a subset
    function neighborsInSubset(v: string, subset: Set<string>): string[] {
      const result: string[] = [];
      const adj = graph.adjacent(v) ?? [];
      for (const w of adj as Iterable<string>) {
        if (subset.has(w)) result.push(w);
      }
      return result;
    }

    // Map each emitted edge (by index) to a color for styling
    const edgeIndexToColor = new Map<number, string>();

    // Find cycles within each cyclic SCC
    for (const scc of cyclicSccs) {
      const membersSet = new Set<string>(scc.members);
      const memberList = [...membersSet].sort(
        // biome-ignore lint/style/noNonNullAssertion: orderIndex is built from orderedNodes
        (a, b) => orderIndex.get(a)! - orderIndex.get(b)!,
      );

      // Find all simple cycles within this SCC
      const cycles: string[][] = [];

      function findCycles(): void {
        for (const start of memberList) {
          const visited = new Set<string>();
          const path: string[] = [];

          function dfs(current: string): void {
            visited.add(current);
            path.push(current);

            for (const next of neighborsInSubset(current, membersSet)) {
              if (next === start && path.length >= 2) {
                // Found a cycle: path + start
                cycles.push([...path, start]);
              } else if (!visited.has(next)) {
                dfs(next);
              }
            }

            path.pop();
            visited.delete(current);
          }

          dfs(start);
        }
      }

      findCycles();

      // Assign colors to cycles, ensuring each cycle gets a unique color
      for (let i = 0; i < cycles.length; i++) {
        const cycle = cycles[i];
        const color = cyclePalette[edgeIndexToColor.size % cyclePalette.length];

        // Color all edges in this cycle
        for (let j = 0; j < cycle.length - 1; j++) {
          const from = cycle[j];
          const to = cycle[j + 1];
          // biome-ignore lint/style/noNonNullAssertion: idMap is built from orderedNodes
          const fromSafe = idMap.get(from)!;
          // biome-ignore lint/style/noNonNullAssertion: idMap is built from orderedNodes
          const toSafe = idMap.get(to)!;

          const edgeIdx = edges.findIndex(
            (e) => e.fromSafe === fromSafe && e.toSafe === toSafe,
          );

          if (edgeIdx !== -1 && !edgeIndexToColor.has(edgeIdx)) {
            edgeIndexToColor.set(edgeIdx, color);
          }
        }
      }
    }

    // Emit linkStyle instructions for colored edges (by emission order)
    for (const [edgeIdx, color] of edgeIndexToColor.entries()) {
      lines.push(
        `  linkStyle ${edgeIdx} stroke:${color},stroke-width:2px,opacity:0.95;`,
      );
    }
  }

  return lines.join("\n");
}
