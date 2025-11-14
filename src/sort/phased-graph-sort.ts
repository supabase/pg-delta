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

/** pg_depend rows that matter for ordering. */
type PgDependRow = {
  /** Object that depends on `referenced_stable_id`. */
  dependent_stable_id: string;
  /** Object being depended upon. */
  referenced_stable_id: string;
  /** Optional dependency type; certain callers treat `a` edges as weak. */
  deptype?: string;
};

/** Sorting phases aligning with execution semantics. */
type Phase = "drop" | "create_alter_object";

/** Predicate for selecting changes targeted by a constraint spec. */
type ChangeFilter =
  | Partial<Pick<Change, "operation" | "objectType" | "scope">>
  | ((change: Change) => boolean);

/** Pairwise decision for additional constraint edges. */
type PairwiseOrder = "a_before_b" | "b_before_a";

/** Edge formats for custom constraints. */
type EdgeIndices = [number, number];
type EdgeObjects<TChange> = { from: TChange; to: TChange };
type Edge<TChange> = EdgeIndices | EdgeObjects<TChange>;

/**
 * ConstraintSpec allows injecting additional ordering constraints per phase.
 *
 * - filter: limit which changes are considered by this spec
 * - groupBy: (optional) partition the filtered set; edges are applied within groups
 * - buildEdges: add explicit edges among items
 * - pairwise: compare two items and produce an ordering decision
 */
interface ConstraintSpec<TChange extends Change> {
  filter?: ChangeFilter; // default: entire phase
  groupBy?: (item: TChange) => string | null | undefined; // optional grouping key
  buildEdges?: (items: TChange[]) => Edge<TChange>[]; // edges within the filtered group(s)
  pairwise?: (a: TChange, b: TChange) => PairwiseOrder | undefined; // pairwise ordering
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
  // Use operation to determine phase, with drops.length as fallback for legacy cases.
  // This ensures ALTER operations (including GRANT/REVOKE) go to create_alter phase,
  // while ACL tracking via creates()/drops() continues to work for dependencies.
  for (const changeItem of changeList) {
    if (changeItem.operation === "drop" && changeItem.drops.length > 0) {
      changesByPhase.drop.push(changeItem);
    } else {
      changesByPhase.create_alter_object.push(changeItem);
    }
  }

  // Phase 1: DROP — reverse dependency order, using dependencies from the main catalog.
  const sortedDropPhase = sortPhaseChanges(
    changesByPhase.drop,
    catalogContext.mainCatalog.depends,
    { invert: true, phase: "drop" },
    constraintSpecs,
  );

  // Phase 2: CREATE/ALTER object definitions — forward order using the branch catalog.
  const sortedCreateAlterPhase = sortPhaseChanges(
    changesByPhase.create_alter_object,
    catalogContext.branchCatalog.depends,
    { phase: "create_alter_object" },
    constraintSpecs,
  );

  return [...sortedDropPhase, ...sortedCreateAlterPhase];
}

/**
 * High-level sort function that applies default privilege ordering constraints.
 *
 * This function encapsulates the domain knowledge about how ALTER DEFAULT PRIVILEGES
 * statements should be ordered relative to CREATE statements, ensuring they run
 * before object creation (except for CREATE ROLE and CREATE SCHEMA, which are
 * dependencies of ALTER DEFAULT PRIVILEGES).
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
 * Build the per-phase graph from catalog edges and optional constraint specs, then
 * run a stable topological sort.
 *
 * - Converts pg_depend rows into a map of referenced id → dependent ids.
 * - Adds edges between Change instances when one creates what another requires.
 * - In DROP phase, edges are inverted so drops run opposite to creation order.
 * - Adds edges from constraint specs (if any).
 */
function sortPhaseChanges(
  phaseChanges: Change[],
  dependencyRows: PgDependRow[],
  options: { invert?: boolean; phase?: Phase } = {},
  constraintSpecs: ConstraintSpec<Change>[] = [],
): Change[] {
  if (phaseChanges.length <= 1) return phaseChanges;

  const filteredDependencyRows = dependencyRows.filter(
    (dependencyRow) =>
      !dependencyRow.referenced_stable_id.startsWith("unknown:") &&
      !dependencyRow.dependent_stable_id.startsWith("unknown:"),
  );

  const dependenciesByReferencedId = new Map<string, Set<string>>();
  for (const dependencyRow of filteredDependencyRows) {
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

  const createdStableIdSets: Array<Set<string>> = phaseChanges.map(
    (changeItem) => {
      const createdIds = new Set<string>(changeItem.creates);
      if (options.invert) {
        for (const droppedId of changeItem.drops ?? []) {
          createdIds.add(droppedId);
        }
      }
      return createdIds;
    },
  );

  const explicitRequirementSets: Array<Set<string>> = phaseChanges.map(
    (changeItem) => new Set<string>(changeItem.requires ?? []),
  );

  const requirementSets: Array<Set<string>> = explicitRequirementSets.map(
    (explicitRequirements) => new Set<string>(explicitRequirements),
  );

  const changeIndexesByCreatedId = new Map<string, Set<number>>();
  for (let changeIndex = 0; changeIndex < phaseChanges.length; changeIndex++) {
    for (const createdId of createdStableIdSets[changeIndex]) {
      let producerIndexes = changeIndexesByCreatedId.get(createdId);
      if (!producerIndexes) {
        producerIndexes = new Set<number>();
        changeIndexesByCreatedId.set(createdId, producerIndexes);
      }
      producerIndexes.add(changeIndex);
    }
  }

  const changeIndexesByExplicitRequirementId = new Map<string, Set<number>>();
  for (
    let changeIndex = 0;
    changeIndex < explicitRequirementSets.length;
    changeIndex++
  ) {
    for (const requiredId of explicitRequirementSets[changeIndex]) {
      let consumerIndexes =
        changeIndexesByExplicitRequirementId.get(requiredId);
      if (!consumerIndexes) {
        consumerIndexes = new Set<number>();
        changeIndexesByExplicitRequirementId.set(requiredId, consumerIndexes);
      }
      consumerIndexes.add(changeIndex);
    }
  }

  const graphEdges: Array<[number, number]> = [];
  const registerEdge = (sourceIndex: number, targetIndex: number) => {
    if (sourceIndex === targetIndex) return;
    graphEdges.push(
      options.invert ? [targetIndex, sourceIndex] : [sourceIndex, targetIndex],
    );
  };

  for (const dependencyRow of filteredDependencyRows) {
    const referencedProducers = changeIndexesByCreatedId.get(
      dependencyRow.referenced_stable_id,
    );
    if (!referencedProducers || referencedProducers.size === 0) continue;

    const consumerIndexes = new Set<number>();
    const explicitConsumerIndexes = changeIndexesByExplicitRequirementId.get(
      dependencyRow.dependent_stable_id,
    );
    if (explicitConsumerIndexes) {
      for (const consumerIndex of explicitConsumerIndexes) {
        consumerIndexes.add(consumerIndex);
      }
    }
    const dependentProducers = changeIndexesByCreatedId.get(
      dependencyRow.dependent_stable_id,
    );
    if (dependentProducers) {
      for (const producerIndex of dependentProducers) {
        consumerIndexes.add(producerIndex);
      }
    }
    if (consumerIndexes.size === 0) continue;

    for (const consumerIndex of consumerIndexes) {
      const consumerChange = phaseChanges[consumerIndex];
      const acceptsDependency = consumerChange.acceptsDependency(
        dependencyRow.dependent_stable_id,
        dependencyRow.referenced_stable_id,
      );
      if (!acceptsDependency) continue;

      requirementSets[consumerIndex].add(dependencyRow.referenced_stable_id);
      for (const producerIndex of referencedProducers) {
        registerEdge(producerIndex, consumerIndex);
      }
    }
  }

  // Create edges directly from creates/requires relationships between changes
  // This handles cases where dependencies aren't in pg_depend (e.g., privileges
  // computed from default privileges that don't exist in the database yet)
  // We iterate through explicitRequirementSets to ensure we catch all explicit
  // requirements, not just those that were also in pg_depend
  for (
    let consumerIndex = 0;
    consumerIndex < phaseChanges.length;
    consumerIndex++
  ) {
    const consumerChange = phaseChanges[consumerIndex];
    for (const requiredId of explicitRequirementSets[consumerIndex]) {
      const producerIndexes = changeIndexesByCreatedId.get(requiredId);
      if (!producerIndexes) continue;
      for (const producerIndex of producerIndexes) {
        if (producerIndex === consumerIndex) continue;
        // For explicit requirements, we check if the consumer accepts the dependency
        // using the consumer's created IDs as the dependent and the required ID as referenced
        const consumerCreates = createdStableIdSets[consumerIndex];
        let acceptsDependency = true;
        if (consumerCreates.size > 0) {
          // Use the first created ID as the dependent (or we could check all)
          const dependentId = Array.from(consumerCreates)[0];
          acceptsDependency = consumerChange.acceptsDependency(
            dependentId,
            requiredId,
          );
        }
        if (!acceptsDependency) continue;
        registerEdge(producerIndex, consumerIndex);
      }
    }
  }

  if (constraintSpecs.length > 0) {
    graphEdges.push(...generateConstraintEdges(phaseChanges, constraintSpecs));
  }

  const deduplicatedEdges = dedupeEdges(graphEdges);
  const topologicalOrder = performStableTopologicalSort(
    phaseChanges.length,
    deduplicatedEdges,
  );

  if (process.env.GRAPH_DEBUG) {
    try {
      const cycleNodeIndexes =
        findCycle(phaseChanges.length, deduplicatedEdges) ?? [];
      const mermaidLines: string[] = [];
      mermaidLines.push("flowchart TD");

      for (
        let changeIndex = 0;
        changeIndex < phaseChanges.length;
        changeIndex++
      ) {
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

      const describeEdge = (sourceIndex: number, targetIndex: number) => {
        for (const createdId of createdStableIdSets[sourceIndex]) {
          if (requirementSets[targetIndex].has(createdId)) {
            return `${createdId} -> (requires)`;
          }
        }
        for (const createdId of createdStableIdSets[sourceIndex]) {
          const outgoingDependencies =
            dependenciesByReferencedId.get(createdId);
          if (!outgoingDependencies) continue;
          for (const requiredId of requirementSets[targetIndex]) {
            if (outgoingDependencies.has(requiredId)) {
              return `${createdId} -> ${requiredId}`;
            }
          }
          for (const targetCreatedId of createdStableIdSets[targetIndex]) {
            if (outgoingDependencies.has(targetCreatedId)) {
              return `${createdId} -> ${targetCreatedId}`;
            }
          }
        }
        return "";
      };

      for (const [sourceIndex, targetIndex] of deduplicatedEdges) {
        const edgeDescription = describeEdge(
          sourceIndex,
          targetIndex,
        ).replaceAll('"', "'");
        if (edgeDescription.length > 0) {
          mermaidLines.push(
            `  n${sourceIndex} -- "${edgeDescription}" --> n${targetIndex}`,
          );
        } else {
          mermaidLines.push(`  n${sourceIndex} --> n${targetIndex}`);
        }
      }

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
        for (const [sourceIndex, targetIndex] of deduplicatedEdges) {
          const edgeBelongsToCycle = cycleEdges.some(
            ([cycleSourceIndex, cycleTargetIndex]) =>
              cycleSourceIndex === sourceIndex &&
              cycleTargetIndex === targetIndex,
          );
          if (edgeBelongsToCycle) {
            mermaidLines.push(
              `  linkStyle ${edgeIndex} stroke:#ff4d4f,stroke-width:2px;`,
            );
          }
          edgeIndex++;
        }
      }

      // eslint-disable-next-line no-console
      console.log(
        [
          "\n==== Mermaid (cycle detected) ====",
          mermaidLines.join("\n"),
          "==== end ====",
        ].join("\n"),
      );
    } catch (_error) {
      // ignore debug printing errors
    }
  }

  if (!topologicalOrder || topologicalOrder.length !== phaseChanges.length) {
    throw new Error("CycleError: dependency graph contains a cycle");
  }
  return topologicalOrder.map((changeIndex) => phaseChanges[changeIndex]);
}

/** Deduplicate edges represented as index pairs. */
function dedupeEdges(edges: Array<[number, number]>): Array<[number, number]> {
  const seenEdges = new Set<string>();
  const uniqueEdges: Array<[number, number]> = [];
  for (const [sourceIndex, targetIndex] of edges) {
    const edgeKey = `${sourceIndex}->${targetIndex}`;
    if (seenEdges.has(edgeKey)) continue;
    seenEdges.add(edgeKey);
    uniqueEdges.push([sourceIndex, targetIndex]);
  }
  return uniqueEdges;
}

/**
 * Stable topological sort. If multiple zero-indegree nodes exist, picks the
 * smallest original index first to preserve input order among unconstrained items.
 * Returns null on cycles.
 */
function performStableTopologicalSort(
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

/** Find one cycle (if any) and return its node indices in order. */
function findCycle(
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
 * Build edges from user-defined constraint specs (applied within the phase).
 *
 * The algorithm:
 * - Select the items via spec.filter (or all items if not provided)
 * - Optionally partition by spec.groupBy, then apply edges within each group
 * - buildEdges can provide explicit edges; pairwise can declare local ordering
 */
function generateConstraintEdges(
  items: Change[],
  specs: ConstraintSpec<Change>[],
): Array<[number, number]> {
  const globalIndexByChange = new Map<Change, number>();
  for (let changeIndex = 0; changeIndex < items.length; changeIndex++) {
    globalIndexByChange.set(items[changeIndex], changeIndex);
  }

  const edges: Array<[number, number]> = [];
  for (const spec of specs) {
    const filteredItems = items.filter((changeItem) =>
      changeMatchesFilter(changeItem, spec.filter),
    );
    if (filteredItems.length === 0) continue;

    const groupedItems = spec.groupBy
      ? groupChangesByKey(filteredItems, spec.groupBy)
      : new Map<string, Change[]>([["__all__", filteredItems]]);

    for (const groupItems of groupedItems.values()) {
      if (groupItems.length <= 1) continue;
      if (spec.buildEdges) {
        for (const edge of spec.buildEdges(groupItems)) {
          if (Array.isArray(edge)) {
            const [sourceLocalIndex, targetLocalIndex] = edge;
            const sourceIndex = globalIndexByChange.get(
              groupItems[sourceLocalIndex],
            );
            const targetIndex = globalIndexByChange.get(
              groupItems[targetLocalIndex],
            );
            if (
              sourceIndex !== undefined &&
              targetIndex !== undefined &&
              sourceIndex !== targetIndex
            ) {
              edges.push([sourceIndex, targetIndex]);
            }
          } else {
            const sourceIndex = globalIndexByChange.get(edge.from);
            const targetIndex = globalIndexByChange.get(edge.to);
            if (
              sourceIndex !== undefined &&
              targetIndex !== undefined &&
              sourceIndex !== targetIndex
            ) {
              edges.push([sourceIndex, targetIndex]);
            }
          }
        }
      }

      if (spec.pairwise) {
        for (let leftIndex = 0; leftIndex < groupItems.length; leftIndex++) {
          for (
            let rightIndex = 0;
            rightIndex < groupItems.length;
            rightIndex++
          ) {
            if (leftIndex === rightIndex) continue;
            const decision = spec.pairwise(
              groupItems[leftIndex],
              groupItems[rightIndex],
            );
            if (!decision) continue;
            const sourceIndex = globalIndexByChange.get(groupItems[leftIndex]);
            const targetIndex = globalIndexByChange.get(groupItems[rightIndex]);
            if (
              sourceIndex === undefined ||
              targetIndex === undefined ||
              sourceIndex === targetIndex
            ) {
              continue;
            }
            edges.push(
              decision === "a_before_b"
                ? [sourceIndex, targetIndex]
                : [targetIndex, sourceIndex],
            );
          }
        }
      }
    }
  }
  return dedupeEdges(edges);
}

/** Matches a change against a filter (object or predicate). */
function changeMatchesFilter(change: Change, filter?: ChangeFilter): boolean {
  if (!filter) return true;
  if (typeof filter === "function") return filter(change);
  if (filter.operation !== undefined && change.operation !== filter.operation)
    return false;
  if (
    filter.objectType !== undefined &&
    change.objectType !== filter.objectType
  ) {
    return false;
  }
  if (filter.scope !== undefined && change.scope !== filter.scope) return false;
  return true;
}

/** Groups items by a key function (undefined/null map to a sentinel bucket). */
function groupChangesByKey<TItem>(
  items: TItem[],
  keySelector: (item: TItem) => string | null | undefined,
) {
  const groupedItems = new Map<string, TItem[]>();
  for (const item of items) {
    const bucketKey = keySelector(item) ?? "__null__";
    const existingBucket = groupedItems.get(bucketKey);
    if (existingBucket) {
      existingBucket.push(item);
    } else {
      groupedItems.set(bucketKey, [item]);
    }
  }
  return groupedItems;
}
