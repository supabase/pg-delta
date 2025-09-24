import { Graph, topologicalSort } from "graph-data-structure";
import type { Change } from "../objects/base.change.ts";

export type ChangeFilter =
  | Partial<Pick<Change, "operation" | "objectType" | "scope">>
  | ((c: Change) => boolean);

export type EdgeIndices = [number, number]; // from -> to (local indices in window)
export type EdgeObjects<T> = { from: T; to: T };
export type Edge<T> = EdgeIndices | EdgeObjects<T>;

export interface TopoWindowSpec<T extends Change> {
  filter: ChangeFilter; // selects consecutive windows to refine
  buildEdges?: (windowItems: T[]) => Edge<T>[]; // optional: construct edges within a window
  pairwise?: (a: T, b: T) => PairwiseOrder | undefined; // optional: per-pair ordering
  groupBy?: (item: T) => string | null | undefined; // optional: further split window by key (e.g., per-table)
}

export type PairwiseOrder = "a_before_b" | "b_before_a";

export function refineByTopologicalWindows<T extends Change>(
  changes: T[],
  spec: TopoWindowSpec<T>,
): T[] {
  const result = changes.slice();

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
