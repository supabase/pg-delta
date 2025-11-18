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
 * - Constraint specs (custom change-to-change ordering rules)
 */

import type { Catalog } from "../catalog.model.ts";
import type { Change } from "../change.types.ts";
import { generateCustomConstraints } from "./constraint-specs.ts";
import { printDebugGraph } from "./debug-visualization.ts";
import {
  buildGraphData,
  convertCatalogDependenciesToConstraints,
  convertConstraintsToEdges,
  convertExplicitRequirementsToConstraints,
} from "./graph-builder.ts";
import {
  dedupeEdges,
  findCycle,
  formatCycleError,
  performStableTopologicalSort,
} from "./topological-sort.ts";
import type { PgDependRow, PhaseSortOptions } from "./types.ts";

/**
 * Sorting phases aligning with execution semantics.
 *
 * - `drop`: Destructive operations that remove objects (executed first, in reverse dependency order)
 * - `create_alter_object`: All remaining changes including creates and alters (executed second, in forward dependency order)
 */
type Phase = "drop" | "create_alter_object";

/**
 * Check if a stable ID represents metadata (ACL, default privileges, etc.)
 * rather than an actual database object.
 */
function isMetadataStableId(stableId: string): boolean {
  return (
    stableId.startsWith("acl:") ||
    stableId.startsWith("defacl:") ||
    stableId.startsWith("aclcol:") ||
    stableId.startsWith("membership:")
  );
}

/**
 * Determine the execution phase for a change based on its properties.
 *
 * This function inspects the change to determine which phase it belongs to,
 * keeping Change classes unaware of sorting implementation details.
 *
 * Rules:
 * - DROP operations → drop phase
 * - CREATE operations → create_alter_object phase
 * - ALTER operations with scope="privilege" → create_alter_object phase (metadata changes)
 * - ALTER operations that drop actual objects → drop phase (destructive ALTER)
 * - ALTER operations that don't drop objects → create_alter_object phase (non-destructive ALTER)
 */
function getExecutionPhase(change: Change): Phase {
  // DROP operations always go to drop phase
  if (change.operation === "drop") {
    return "drop";
  }

  // CREATE operations always go to create_alter phase
  if (change.operation === "create") {
    return "create_alter_object";
  }

  // For ALTER operations, determine based on what they do
  if (change.operation === "alter") {
    // Privilege changes (metadata) always go to create_alter phase
    if (change.scope === "privilege") {
      return "create_alter_object";
    }

    // Check if this ALTER drops actual objects (not metadata)
    const droppedIds = change.drops ?? [];
    const dropsObjects = droppedIds.some((id) => !isMetadataStableId(id));

    if (dropsObjects) {
      // Destructive ALTER (DROP COLUMN, DROP CONSTRAINT, etc.) → drop phase
      return "drop";
    }

    // Non-destructive ALTER (ADD COLUMN, GRANT, etc.) → create_alter phase
    return "create_alter_object";
  }

  // Safe default
  return "create_alter_object";
}

/**
 * Sort changes using dependency information from catalogs and custom constraint specs.
 *
 * @param catalogs - Main and branch catalogs containing dependency information
 * @param changes - List of Change objects to order
 * @returns Ordered list of Change objects
 */
export function sortChanges(
  catalogs: { mainCatalog: Catalog; branchCatalog: Catalog },
  changes: Change[],
): Change[] {
  return sortChangesByPhasedGraph(
    {
      mainCatalog: { depends: catalogs.mainCatalog.depends },
      branchCatalog: { depends: catalogs.branchCatalog.depends },
    },
    changes,
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
 * 2. Convert all sources to Constraints (catalog, explicit, constraint specs)
 * 3. Convert Constraints to edges
 * 4. Topologically sort the graph
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
    phaseChanges,
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

  // Step 3: Convert constraints to edges
  const graphEdges: Array<[number, number]> = [];
  const registerEdge = (sourceIndex: number, targetIndex: number) => {
    if (sourceIndex === targetIndex) return;
    graphEdges.push(
      options.invert ? [targetIndex, sourceIndex] : [sourceIndex, targetIndex],
    );
  };

  convertConstraintsToEdges(allConstraints, registerEdge);

  // Step 4: Deduplicate edges and perform stable topological sort
  const deduplicatedEdges = dedupeEdges(graphEdges);
  const topologicalOrder = performStableTopologicalSort(
    phaseChanges.length,
    deduplicatedEdges,
  );

  if (process.env.GRAPH_DEBUG) {
    // Debug visualization
    printDebugGraph(
      phaseChanges,
      graphData,
      deduplicatedEdges,
      dependencyRows,
      allConstraints,
    );
  }

  // Step 5: Validate no cycles exist
  if (!topologicalOrder || topologicalOrder.length !== phaseChanges.length) {
    const cycleNodeIndexes = findCycle(phaseChanges.length, deduplicatedEdges);
    if (cycleNodeIndexes) {
      throw new Error(formatCycleError(cycleNodeIndexes, phaseChanges));
    }
    throw new Error("CycleError: dependency graph contains a cycle");
  }

  return topologicalOrder.map((changeIndex) => phaseChanges[changeIndex]);
}
