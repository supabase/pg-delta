/**
 * Phased dependency-graph sort for ordered schema changes.
 *
 * We split incoming `Change` instances into two execution phases that mirror how
 * PostgreSQL applies DDL: destructive operations (`drop`) and all remaining
 * changes (`create_alter_object`). Metadata and privilege statements rely on
 * their declared dependencies to run after the structural work in the combined
 * phase.
 *
 * Within each phase we:
 *   1. Collect dependency edges from pg_depend for the relevant catalog snapshot.
 *   2. Map those dependency edges onto the `Change` objects based on their
 *      `creates`/`requires` stable ids (with optional `drops()` hooks coming from
 *      the change implementations).
 *   3. Add any extra ordering constraints provided by `constraintSpecs`.
 *   4. Execute a stable topological sort to preserve the user's submission order
 *      whenever dependencies do not dictate a stricter ordering.
 *
 * This approach keeps the algorithm aligned with PostgreSQL's dependency system,
 * avoiding brittle hand-maintained priority tables while still giving us hooks for
 * targeted overrides (for example, column-level ordering on a table).
 */

import type { Catalog } from "../catalog.model.ts";
import type { Change } from "../change.types.ts";
import {
  GrantRoleDefaultPrivileges,
  RevokeRoleDefaultPrivileges,
} from "../objects/role/changes/role.privilege.ts";
import { generateConstraintEdges } from "./constraint-specs.ts";
import { printDebugGraph } from "./debug-visualization.ts";
import { filterDependencies } from "./dependency-filter.ts";
import {
  buildChangeSets,
  buildEdgesFromDependencies,
  buildGraphData,
  convertCatalogDependencies,
  convertExplicitRequirements,
} from "./graph-builder.ts";
import {
  dedupeEdges,
  findCycle,
  formatCycleError,
  performStableTopologicalSort,
} from "./topological-sort.ts";
import type { ConstraintSpec, PgDependRow, PhaseSortOptions } from "./types.ts";

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
 * High-level sort function that applies custom ordering constraints.
 *
 * This function encapsulates domain-specific ordering rules that supplement
 * the dependency graph. These constraints handle cases where the dependency
 * system alone isn't sufficient to determine the correct execution order.
 *
 * @param catalogs - Main and branch catalogs containing dependency information
 * @param changes - List of Change objects to order
 * @returns Ordered list of Change objects
 */
export function sortChanges(
  catalogs: { mainCatalog: Catalog; branchCatalog: Catalog },
  changes: Change[],
): Change[] {
  // Ensure ALTER DEFAULT PRIVILEGES comes before CREATE statements in the final migration
  // The dependency system handles role/schema dependencies automatically
  // Privilege changes for CREATE statements are now generated during diffing using
  // the default privileges state computed from role changes
  const constraintSpecs: ConstraintSpec<Change>[] = [
    {
      pairwise: (a: Change, b: Change) => {
        const aIsDefaultPriv =
          a instanceof GrantRoleDefaultPrivileges ||
          a instanceof RevokeRoleDefaultPrivileges;
        const bIsCreate = b.operation === "create" && b.scope === "object";

        // Exclude CREATE ROLE and CREATE SCHEMA from the constraint since they are
        // dependencies of ALTER DEFAULT PRIVILEGES and must come before it
        const bIsRoleOrSchema =
          bIsCreate && (b.objectType === "role" || b.objectType === "schema");

        // Default privilege changes should come before CREATE statements
        // (but not CREATE ROLE or CREATE SCHEMA, which are dependencies)
        // Note: pairwise is called for both (a,b) and (b,a), so we only need to check one direction
        if (aIsDefaultPriv && bIsCreate && !bIsRoleOrSchema) {
          return "a_before_b";
        }
        return undefined;
      },
    },
  ];

  return sortChangesByPhasedGraph(
    {
      mainCatalog: { depends: catalogs.mainCatalog.depends },
      branchCatalog: { depends: catalogs.branchCatalog.depends },
    },
    changes,
    constraintSpecs,
  );
}

/**
 * Sort a set of changes by phases, using dependency graphs in each phase.
 *
 * @param catalogContext - pg_depend rows from the main and branch catalogs
 * @param changeList - list of Change objects to order
 * @param constraintSpecs - optional additional edge providers
 * @returns ordered list of Change objects
 */
function sortChangesByPhasedGraph(
  catalogContext: {
    mainCatalog: { depends: PgDependRow[] };
    branchCatalog: { depends: PgDependRow[] };
  },
  changeList: Change[],
  constraintSpecs: ConstraintSpec<Change>[] = [],
): Change[] {
  const changesByPhase: Record<Phase, Change[]> = {
    drop: [],
    create_alter_object: [],
  };

  // Partition changes into execution phases.
  // The sorting algorithm determines phases by inspecting change properties,
  // keeping Change classes unaware of sorting implementation details.
  for (const changeItem of changeList) {
    const phase = getExecutionPhase(changeItem);
    changesByPhase[phase].push(changeItem);
  }

  // Phase 1: DROP — reverse dependency order, using dependencies from the main catalog.
  const sortedDropPhase = sortPhaseChanges(
    changesByPhase.drop,
    catalogContext.mainCatalog.depends,
    { invert: true },
    constraintSpecs,
  );

  // Phase 2: CREATE/ALTER object definitions — forward order using the branch catalog.
  const sortedCreateAlterPhase = sortPhaseChanges(
    changesByPhase.create_alter_object,
    catalogContext.branchCatalog.depends,
    {},
    constraintSpecs,
  );

  return [...sortedDropPhase, ...sortedCreateAlterPhase];
}

/**
 * Build the per-phase graph from catalog edges and optional constraint specs, then
 * run a stable topological sort.
 *
 * The algorithm:
 * 1. Build graph data structures (created IDs, required IDs, indexes)
 * 2. Add edges from pg_depend catalog rows
 * 3. Add edges from explicit creates/requires relationships
 * 4. Add edges from constraint specs (if any)
 * 5. Deduplicate edges
 * 6. Perform stable topological sort
 * 7. Validate no cycles exist
 *
 * In DROP phase, edges are inverted so drops run opposite to creation order.
 */
function sortPhaseChanges(
  phaseChanges: Change[],
  dependencyRows: PgDependRow[],
  options: PhaseSortOptions = {},
  constraintSpecs: ConstraintSpec<Change>[] = [],
): Change[] {
  if (phaseChanges.length <= 1) return phaseChanges;

  // Step 1: Build change sets (created and required IDs) from changes
  // These only depend on the changes themselves, not on dependencies
  const { createdStableIdSets, explicitRequirementSets } = buildChangeSets(
    phaseChanges,
    options,
  );

  // Step 2: Convert all dependencies (catalog + explicit) into a single format
  const catalogDeps = convertCatalogDependencies(dependencyRows);
  const explicitDeps = convertExplicitRequirements(
    phaseChanges,
    createdStableIdSets,
    explicitRequirementSets,
  );
  const allDependencies = [...catalogDeps, ...explicitDeps];

  // Step 3: Build graph data structures (needed for filtering and building edges)
  // This builds reverse indexes from the change sets, which are needed by both
  // the filter (for findConsumerIndexes) and edge building logic
  const graphData = buildGraphData(
    phaseChanges,
    createdStableIdSets,
    explicitRequirementSets,
  );

  // Step 4: Filter dependencies (remove unknown, sequence ownership cycles, etc.)
  const filteredDependencies = filterDependencies(
    allDependencies,
    phaseChanges,
    graphData,
  );

  // Step 5: Build edges from filtered dependencies
  const graphEdges: Array<[number, number]> = [];
  const registerEdge = (sourceIndex: number, targetIndex: number) => {
    if (sourceIndex === targetIndex) return;
    graphEdges.push(
      options.invert ? [targetIndex, sourceIndex] : [sourceIndex, targetIndex],
    );
  };

  buildEdgesFromDependencies(
    {
      changeIndexesByCreatedId: graphData.changeIndexesByCreatedId,
      changeIndexesByExplicitRequirementId:
        graphData.changeIndexesByExplicitRequirementId,
      createdStableIdSets: graphData.createdStableIdSets,
      explicitRequirementSets: graphData.explicitRequirementSets,
      registerEdge,
    },
    filteredDependencies,
    phaseChanges,
  );

  // Add edges from constraint specs
  if (constraintSpecs.length > 0) {
    graphEdges.push(...generateConstraintEdges(phaseChanges, constraintSpecs));
  }

  // Deduplicate and sort
  const deduplicatedEdges = dedupeEdges(graphEdges);
  const topologicalOrder = performStableTopologicalSort(
    phaseChanges.length,
    deduplicatedEdges,
  );

  // Debug visualization (builds debug-only data just-in-time)
  printDebugGraph(
    phaseChanges,
    graphData,
    deduplicatedEdges,
    dependencyRows,
    allDependencies,
  );

  // Validate no cycles
  if (!topologicalOrder || topologicalOrder.length !== phaseChanges.length) {
    const cycleNodeIndexes = findCycle(phaseChanges.length, deduplicatedEdges);
    if (cycleNodeIndexes) {
      throw new Error(formatCycleError(cycleNodeIndexes, phaseChanges));
    }
    throw new Error("CycleError: dependency graph contains a cycle");
  }

  return topologicalOrder.map((changeIndex) => phaseChanges[changeIndex]);
}
