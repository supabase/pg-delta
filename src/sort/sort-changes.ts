/**
 * Phased dependency-graph sort for ordered schema changes.
 *
 * Changes are split into two execution phases:
 * - `drop`: Destructive operations (executed first, in reverse dependency order)
 * - `create_alter_object`: All remaining changes (executed second, in forward dependency order)
 *
 * Within each phase, changes are sorted using Constraints derived from:
 * - Catalog dependencies (from pg_depend)
 * - Explicit requirements (from Change.requires)
 * - Custom constraints (change-to-change ordering rules)
 */

import type { Catalog } from "../catalog.model.ts";
import type { Change } from "../change.types.ts";
import { generateCustomConstraints } from "./custom-constraints.ts";
import { printDebugGraph } from "./debug-visualization.ts";
import {
  filterEdgesForCycleBreaking,
  getEdgesInCycle,
} from "./dependency-filter.ts";
import {
  buildGraphData,
  convertCatalogDependenciesToConstraints,
  convertConstraintsToEdges,
  convertExplicitRequirementsToConstraints,
  edgesToPairs,
} from "./graph-builder.ts";
import { dedupeEdges } from "./graph-utils.ts";
import { logicalSort } from "./logical-sort.ts";
import {
  findCycle,
  formatCycleError,
  performStableTopologicalSort,
} from "./topological-sort.ts";
import type { PgDependRow, PhaseSortOptions } from "./types.ts";
import { getExecutionPhase, type Phase } from "./utils.ts";

/**
 * Sort changes using dependency information from catalogs and custom constraints.
 *
 * First applies logical pre-sorting to group related changes together,
 * then applies dependency-based topological sorting to ensure correct execution order.
 *
 * @param catalogs - Main and branch catalogs containing dependency information
 * @param changes - List of Change objects to order
 * @returns Ordered list of Change objects
 */
export function sortChanges(
  catalogs: { mainCatalog: Catalog; branchCatalog: Catalog },
  changes: Change[],
): Change[] {
  // Step 1: Apply logical pre-sorting to group changes by object type, stable ID, and scope
  const logicallySorted = logicalSort(changes);

  // Step 2: Apply dependency-based topological sorting
  return sortChangesByPhasedGraph(
    {
      mainCatalog: { depends: catalogs.mainCatalog.depends },
      branchCatalog: { depends: catalogs.branchCatalog.depends },
    },
    logicallySorted,
  );
}

/**
 * Sort changes by phases, using dependency information in each phase.
 *
 * @param catalogContext - pg_depend rows from the main and branch catalogs
 * @param changeList - list of Change objects to order
 * @returns ordered list of Change objects
 */
function sortChangesByPhasedGraph(
  catalogContext: {
    mainCatalog: { depends: PgDependRow[] };
    branchCatalog: { depends: PgDependRow[] };
  },
  changeList: Change[],
): Change[] {
  const changesByPhase: Record<Phase, Change[]> = {
    drop: [],
    create_alter_object: [],
  };

  // Partition changes into execution phases
  for (const changeItem of changeList) {
    const phase = getExecutionPhase(changeItem);
    changesByPhase[phase].push(changeItem);
  }

  // Sort DROP phase: reverse dependency order using main catalog dependencies
  const sortedDropPhase = sortPhaseChanges(
    changesByPhase.drop,
    catalogContext.mainCatalog.depends,
    { invert: true },
  );

  // Sort CREATE/ALTER phase: forward dependency order using branch catalog dependencies
  const sortedCreateAlterPhase = sortPhaseChanges(
    changesByPhase.create_alter_object,
    catalogContext.branchCatalog.depends,
    {},
  );

  return [...sortedDropPhase, ...sortedCreateAlterPhase];
}

/**
 * Sort changes within a phase using Constraints derived from all dependency sources.
 *
 * Algorithm:
 * 1. Build graph data (change sets and reverse indexes)
 * 2. Convert all sources to Constraints (catalog, explicit, custom constraints)
 * 3. Convert Constraints to edges
 * 4. Iteratively detect and break cycles (deduplicate edges, detect cycles, filter problematic edges)
 * 5. Perform stable topological sort on the acyclic graph
 *
 * In DROP phase, edges are inverted so drops run in reverse dependency order.
 */
function sortPhaseChanges(
  phaseChanges: Change[],
  dependencyRows: PgDependRow[],
  options: PhaseSortOptions = {},
): Change[] {
  if (phaseChanges.length <= 1) return phaseChanges;

  // Step 1: Build graph data structures
  const graphData = buildGraphData(phaseChanges, options);

  // Step 2: Convert all sources to Constraints
  const catalogConstraints = convertCatalogDependenciesToConstraints(
    dependencyRows,
    graphData,
  );
  const explicitConstraints = convertExplicitRequirementsToConstraints(
    phaseChanges,
    graphData,
  );
  const customConstraintObjects = generateCustomConstraints(phaseChanges);
  const allConstraints = [
    ...catalogConstraints,
    ...explicitConstraints,
    ...customConstraintObjects,
  ];

  // Step 3: Convert constraints to edges and deduplicate immediately
  let edges = dedupeEdges(convertConstraintsToEdges(allConstraints, options));

  // Step 4: Iteratively detect and break cycles
  // Track cycles we've seen to detect when filtering fails to break a cycle.
  // The only way we loop indefinitely is if we encounter a cycle we've already seen,
  // which means filtering didn't break it. Otherwise, we continue until all cycles are broken.
  const seenCycles = new Set<string>();

  /**
   * Normalize a cycle by rotating it to start with the smallest node index.
   * This allows us to compare cycles regardless of where they start.
   */
  function normalizeCycle(cycleNodeIndexes: number[]): string {
    if (cycleNodeIndexes.length === 0) return "";
    const minIndex = Math.min(...cycleNodeIndexes);
    const minIndexPos = cycleNodeIndexes.indexOf(minIndex);
    const rotated = [
      ...cycleNodeIndexes.slice(minIndexPos),
      ...cycleNodeIndexes.slice(0, minIndexPos),
    ];
    return rotated.join(",");
  }

  while (true) {
    // Edge deduplication moved outside loop
    const edgePairs = edgesToPairs(edges);

    // Detect cycles
    const cycleNodeIndexes = findCycle(phaseChanges.length, edgePairs);

    if (!cycleNodeIndexes) {
      // No cycles found, we're done
      break;
    }

    // Normalize cycle to check if we've seen it before
    const cycleSignature = normalizeCycle(cycleNodeIndexes);
    if (seenCycles.has(cycleSignature)) {
      // We've seen this cycle before - filtering didn't break it
      // Get edges involved in the cycle for detailed error message
      const cycleEdges = getEdgesInCycle(cycleNodeIndexes, edges);
      throw new Error(
        formatCycleError(cycleNodeIndexes, phaseChanges, cycleEdges),
      );
    }

    // Track this cycle
    seenCycles.add(cycleSignature);

    // Filter only edges involved in the cycle to break it
    edges = filterEdgesForCycleBreaking(
      edges,
      cycleNodeIndexes,
      phaseChanges,
      graphData,
    );
  }

  const finalEdgePairs = edgesToPairs(edges);

  if (process.env.GRAPH_DEBUG) {
    // Debug visualization
    printDebugGraph(
      phaseChanges,
      graphData,
      finalEdgePairs,
      dependencyRows,
      allConstraints,
    );
  }

  // Step 5: Perform stable topological sort (no cycles, so this will succeed)
  const topologicalOrder = performStableTopologicalSort(
    phaseChanges.length,
    finalEdgePairs,
  );

  if (!topologicalOrder || topologicalOrder.length !== phaseChanges.length) {
    // This should never happen if findCycle returned null, but guard anyway
    throw new Error("CycleError: dependency graph contains a cycle");
  }

  return topologicalOrder.map((changeIndex) => phaseChanges[changeIndex]);
}
