import { Graph, topologicalSort } from "graph-data-structure";
import type { Change } from "../objects/base.change.ts";

/**
 * A filter that selects which changes belong to a window for refinement.
 * Can be either an object matching change attributes or a custom predicate function.
 */
type ChangeFilter =
  | Partial<Pick<Change, "operation" | "objectType" | "scope">>
  | ((c: Change) => boolean);

/**
 * An edge represented as local indices within a window: [from_index, to_index].
 */
type EdgeIndices = [number, number];

/**
 * An edge represented as references to the actual change objects.
 */
type EdgeObjects<T> = { from: T; to: T };

/**
 * An edge in a dependency graph, either as indices or object references.
 */
type Edge<T> = EdgeIndices | EdgeObjects<T>;

/**
 * Configuration for a single topological refinement pass over a window of changes.
 *
 * A "window" is a consecutive sequence of changes matching the filter. This spec defines:
 * - How to identify windows (via filter)
 * - How to determine ordering constraints within a window (via buildEdges or pairwise)
 * - How to optionally subdivide windows into smaller groups (via groupBy)
 */
export interface TopoWindowSpec<T extends Change> {
  /** Selects which consecutive changes form a window to be refined */
  filter: ChangeFilter;

  /** Explicitly construct dependency edges within the window */
  buildEdges?: (windowItems: T[]) => Edge<T>[];

  /** Determine ordering between each pair of changes in the window */
  pairwise?: (a: T, b: T) => PairwiseOrder | undefined;

  /** Subdivide the window into smaller consecutive groups (e.g., per-table changes) */
  groupBy?: (item: T) => string | null | undefined;
}

/**
 * Ordering constraint between two changes in a pair.
 */
type PairwiseOrder = "a_before_b" | "b_before_a";

/**
 * Refines the order of changes within windows using topological sorting.
 *
 * This implements the **second pass** of the two-pass sorting strategy, applying
 * fine-grained dependency resolution within specific windows of changes that were
 * already coarsely sorted in the first pass.
 *
 * **How it works:**
 * 1. Scans the input array to find consecutive "windows" of changes matching the filter
 * 2. Within each window, constructs a dependency graph using buildEdges and/or pairwise
 * 3. Topologically sorts the window to satisfy all dependency constraints
 * 4. Replaces the window in-place with the sorted result
 * 5. Moves to the next window and repeats
 *
 * **Why this is needed:**
 * After the global sort establishes a baseline order, there are still fine-grained
 * dependency conflicts that require analyzing actual object relationships:
 * - ALTER TABLE operations on the same table (e.g., DROP COLUMN before ADD COLUMN)
 * - ALTER TABLE ADD COLUMN with dependencies between columns (generated columns)
 * - Views/materialized views with inter-view dependencies
 * - Any other case where changes of the same type need ordering based on their content
 *
 * **Cycle handling:**
 * If a window contains a dependency cycle, the topological sort fails and the window
 * is left in its original order. This is intentional: we preserve the global sort's
 * order rather than arbitrarily breaking cycles.
 *
 * **Performance:**
 * This is more expensive than the first pass (requires graph construction and topo sort),
 * but operates only on small windows rather than the full change list, making it practical.
 *
 * @param changes - Array of changes (typically already globally sorted)
 * @param spec - Configuration defining windows and their ordering constraints
 * @returns A new array with refined ordering within each window
 *
 * @example
 * ```ts
 * // Refine ALTER TABLE operations within the same table
 * const refined = refineByTopologicalWindows(changes, {
 *   filter: { operation: "alter", objectType: "table" },
 *   pairwise: (a, b) => {
 *     if (a.tableId === b.tableId && a.isDropColumn && b.isAddColumn) {
 *       return "a_before_b"; // drop columns before adding new ones
 *     }
 *     return undefined;
 *   }
 * });
 * ```
 */
export function refineByTopologicalWindows<T extends Change>(
  changes: T[],
  spec: TopoWindowSpec<T>,
): T[] {
  const result = Array.from(changes);

  let i = 0;
  while (i < result.length) {
    if (!matchesFilter(result[i], spec.filter)) {
      i++;
      continue;
    }

    // Find maximal consecutive window matching the filter
    const start = i;
    let j = i + 1;
    while (j < result.length && matchesFilter(result[j], spec.filter)) j++;

    if (!spec.groupBy) {
      refineSlice(result, start, j, spec);
    } else {
      // Further split by consecutive segments of equal group key
      let p = start;
      while (p < j) {
        const baseKey = spec.groupBy(result[p]) ?? "__all__";
        let q = p + 1;
        while (q < j && (spec.groupBy(result[q]) ?? "__all__") === baseKey) {
          q++;
        }
        refineSlice(result, p, q, spec);
        p = q;
      }
    }

    i = j;
  }

  return result;
}

/**
 * Refines a single slice (window) of the array by topologically sorting it.
 *
 * This function:
 * 1. Extracts the window slice from the array
 * 2. Builds a dependency graph using edges from buildEdges and/or pairwise
 * 3. Performs topological sort on the graph
 * 4. Replaces the slice in the original array with the sorted result
 *
 * If topological sort fails (cycle detected) or returns an invalid result,
 * the slice is left unchanged in its original order.
 *
 * @param arr - The full array being refined (modified in-place)
 * @param from - Start index of the window (inclusive)
 * @param to - End index of the window (exclusive)
 * @param spec - Specification defining how to order items in the window
 */
function refineSlice<T extends Change>(
  arr: T[],
  from: number,
  to: number,
  spec: TopoWindowSpec<T>,
) {
  const window = arr.slice(from, to);
  if (window.length <= 1) return;

  // Build edges from callback
  const edges: EdgeIndices[] = [];
  if (spec.buildEdges) {
    edges.push(...normalizeEdges(window, spec.buildEdges(window)));
  }
  if (spec.pairwise) {
    for (let i = 0; i < window.length; i++) {
      for (let j = 0; j < window.length; j++) {
        if (i === j) continue;
        const decision = spec.pairwise(window[i], window[j]);
        if (decision === "a_before_b") edges.push([i, j]);
        else if (decision === "b_before_a") edges.push([j, i]);
      }
    }
  }
  if (edges.length === 0) return; // nothing to order

  // Build graph over local indices 0..k-1
  const g = new Graph<string, null>();
  const nodeIds: string[] = window.map((_it, idx) => idx.toString());
  for (const id of nodeIds) {
    g.addNode(id);
  }
  for (const [u, v] of dedupeEdges(edges)) {
    if (u >= 0 && v >= 0 && u < nodeIds.length && v < nodeIds.length) {
      g.addEdge(nodeIds[u], nodeIds[v], { props: null });
    }
  }

  // Topological sort; on failure (cycle), keep original order
  let orderedIds: string[];
  try {
    orderedIds = topologicalSort(g);
  } catch (_e) {
    return; // cycle: leave slice unchanged
  }

  if (orderedIds.length !== window.length) return; // invalid result, keep original

  const ordered = orderedIds.map((id) => window[parseInt(id, 10)]);
  for (let k = 0; k < ordered.length; k++) arr[from + k] = ordered[k];
}

/**
 * Tests whether a change matches the given filter.
 *
 * If the filter is a function, it's called directly.
 * If the filter is an object, the change must match all defined fields.
 *
 * @param change - The change to test
 * @param filter - The filter to match against
 * @returns true if the change matches the filter
 */
function matchesFilter(change: Change, filter: ChangeFilter): boolean {
  if (typeof filter === "function") return filter(change);
  if (filter.operation !== undefined && change.operation !== filter.operation)
    return false;
  if (
    filter.objectType !== undefined &&
    change.objectType !== filter.objectType
  )
    return false;
  if (filter.scope !== undefined && change.scope !== filter.scope) return false;
  return true;
}

/**
 * Converts edges from object references to local indices within the window.
 *
 * Edges can be specified either as index pairs [from, to] or as object references
 * { from, to }. This function normalizes both formats into index pairs so they can
 * be added to the graph.
 *
 * @param items - The items in the window (used to map objects to indices)
 * @param input - Array of edges in either format
 * @returns Array of edges as index pairs
 */
function normalizeEdges<T>(items: T[], input: Edge<T>[]): EdgeIndices[] {
  const indexOf = new Map<T, number>();
  for (let i = 0; i < items.length; i++) {
    indexOf.set(items[i], i);
  }
  const out: EdgeIndices[] = [];
  for (const e of input) {
    if (Array.isArray(e)) {
      out.push(e);
    } else {
      const u = indexOf.get(e.from);
      const v = indexOf.get(e.to);
      if (u !== undefined && v !== undefined) out.push([u, v]);
    }
  }
  return out;
}

/**
 * Removes duplicate edges from an edge list.
 *
 * Multiple sources might produce the same edge (e.g., both buildEdges and pairwise
 * might say "A depends on B"). This function deduplicates them to avoid redundant
 * graph edges.
 *
 * @param edges - Array of edges that may contain duplicates
 * @returns Array of unique edges
 */
function dedupeEdges(edges: EdgeIndices[]): EdgeIndices[] {
  const seen = new Set<string>();
  const out: EdgeIndices[] = [];
  for (const [u, v] of edges) {
    const key = `${u}->${v}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([u, v]);
  }
  return out;
}
