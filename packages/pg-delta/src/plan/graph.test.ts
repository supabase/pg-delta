/**
 * Unit coverage for the deterministic heap-based Kahn sort (src/plan/graph.ts).
 *
 * `topoSort` memoizes the caller's tie-key function per node index, because the
 * heap consults it inside every sift comparison. These tests pin that the
 * memoization is transparent: the emitted order matches a naive reference sort
 * (repeatedly take the lexicographically smallest ready node), and each node's
 * key is computed exactly once.
 */
import { describe, expect, test } from "bun:test";
import { topoSort } from "./graph.ts";

type Edge = [before: number, after: number];

/** Reference implementation: O(n^2) selection of the smallest ready key. No
 *  heap, no memoization — the ground truth for "deterministic Kahn". */
function referenceSort(
  nodeCount: number,
  edges: Edge[],
  keyOf: (n: number) => string,
): number[] {
  const indegree = new Array<number>(nodeCount).fill(0);
  const adjacency: number[][] = Array.from({ length: nodeCount }, () => []);
  const seen = new Set<string>();
  for (const [u, v] of edges) {
    if (u === v) continue;
    const k = `${u}>${v}`;
    if (seen.has(k)) continue;
    seen.add(k);
    adjacency[u]!.push(v);
    indegree[v]! += 1;
  }
  const ready = new Set<number>();
  for (let i = 0; i < nodeCount; i++) if (indegree[i] === 0) ready.add(i);
  const order: number[] = [];
  while (ready.size > 0) {
    let best: number | undefined;
    for (const n of ready) {
      if (best === undefined || keyOf(n) < keyOf(best)) best = n;
    }
    ready.delete(best!);
    order.push(best!);
    for (const next of adjacency[best!]!) {
      indegree[next]! -= 1;
      if (indegree[next] === 0) ready.add(next);
    }
  }
  return order;
}

/** Deterministic PRNG so a failure is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random DAG: edges only ever point from a lower to a higher rank, so it is
 *  acyclic by construction, while the NODE ids are shuffled so index order
 *  carries no ordering information. */
function randomDag(
  seed: number,
  nodeCount: number,
  edgeCount: number,
): { edges: Edge[]; keyOf: (n: number) => string } {
  const rnd = mulberry32(seed);
  const rank = Array.from({ length: nodeCount }, (_, i) => i);
  for (let i = nodeCount - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [rank[i], rank[j]] = [rank[j]!, rank[i]!];
  }
  const edges: Edge[] = [];
  for (let e = 0; e < edgeCount; e++) {
    const a = Math.floor(rnd() * nodeCount);
    const b = Math.floor(rnd() * nodeCount);
    if (rank[a]! === rank[b]!) continue;
    edges.push(rank[a]! < rank[b]! ? [a, b] : [b, a]);
  }
  // Deliberately COLLIDING tie keys (a small alphabet) so equal-key nodes are
  // common and the padded index suffix is what actually breaks the tie — the
  // shape `actionTieKey` produces.
  const keys = Array.from(
    { length: nodeCount },
    (_, i) =>
      `${String(Math.floor(rnd() * 4))}|${"abc"[Math.floor(rnd() * 3)]}|${String(i).padStart(6, "0")}`,
  );
  return { edges, keyOf: (n) => keys[n]! };
}

describe("topoSort", () => {
  test("respects edges and breaks ties by key on a simple graph", () => {
    // 0 -> 2, 1 -> 2; keys make 1 sort before 0
    const keys = ["b", "a", "c", "a0"];
    const order = topoSort(
      4,
      [
        [0, 2],
        [1, 2],
      ],
      (n) => keys[n]!,
      (n) => `node ${n}`,
    );
    expect(order).toEqual([1, 3, 0, 2]);
  });

  test("matches the naive reference sort on shuffled random DAGs", () => {
    for (const seed of [1, 2, 3, 7, 42, 1337, 99991]) {
      const { edges, keyOf } = randomDag(seed, 200, 600);
      const got = topoSort(200, edges, keyOf, (n) => `node ${n}`);
      expect(got).toEqual(referenceSort(200, edges, keyOf));
      expect(got).toHaveLength(200);
      expect(new Set(got).size).toBe(200);
    }
  });

  test("computes each node's tie key exactly once", () => {
    const { edges, keyOf } = randomDag(4711, 300, 900);
    const calls = new Map<number, number>();
    const counted = (n: number): string => {
      calls.set(n, (calls.get(n) ?? 0) + 1);
      return keyOf(n);
    };
    const order = topoSort(300, edges, counted, (n) => `node ${n}`);
    expect(order).toEqual(referenceSort(300, edges, keyOf));
    // No node is keyed twice — the memo property. (A node pushed onto an EMPTY
    // heap, or popped as the only item, is never compared, so the total is
    // nodeCount or slightly under; without the memo it is O(n log n).)
    expect([...calls.values()].every((c) => c === 1)).toBe(true);
    expect(calls.size).toBeLessThanOrEqual(300);
    expect(calls.size).toBeGreaterThan(290);
  });

  test("reports a cycle instead of repairing it", () => {
    expect(() =>
      topoSort(
        3,
        [
          [0, 1],
          [1, 2],
          [2, 0],
        ],
        (n) => `k${n}`,
        (n) => `node ${n}`,
      ),
    ).toThrow(/dependency cycle among 3 actions/);
  });

  test("ignores self-edges and duplicate edges", () => {
    const keys = ["a", "b"];
    const order = topoSort(
      2,
      [
        [0, 0],
        [1, 0],
        [1, 0],
      ],
      (n) => keys[n]!,
      (n) => `node ${n}`,
    );
    expect(order).toEqual([1, 0]);
  });
});
