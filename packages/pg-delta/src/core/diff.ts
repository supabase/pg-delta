/**
 * Generic diff: rollup-guided descent to fact-level deltas
 * (target-architecture §3.3).
 *
 * ZERO per-kind code lives here — by design and by test. The differ never
 * knows what a table is; per-kind significance is the rule table's job.
 */
import type { DependencyEdge, Fact, FactBase } from "./fact.ts";
import { canonicalize, type PayloadValue } from "./hash.ts";
import { encodeId, type StableId } from "./stable-id.ts";

export type Delta =
  | { verb: "add"; fact: Fact }
  | { verb: "remove"; fact: Fact }
  | {
      verb: "set";
      id: StableId;
      attr: string;
      from: PayloadValue;
      to: PayloadValue;
    }
  | { verb: "link"; edge: DependencyEdge }
  | { verb: "unlink"; edge: DependencyEdge };

function edgeKey(e: DependencyEdge): string {
  return `${encodeId(e.from)}|${e.kind}|${encodeId(e.to)}`;
}

export function diff(a: FactBase, b: FactBase): Delta[] {
  const deltas: Delta[] = [];

  // Facts present for reference only (managed-view projection of a policy's
  // assumedSchemas): kept so dependents resolve, but never diffed. Skip a fact's
  // OWN deltas (and edges) when it is reference-only on EITHER side, while still
  // descending into its children — a managed object (a user trigger) can be a
  // child of a reference-only parent (the platform `auth.users`).
  const isReferenceOnly = (id: StableId): boolean => {
    const key = encodeId(id);
    return a.referenceOnly.has(key) || b.referenceOnly.has(key);
  };

  const emitSubtree = (
    fb: FactBase,
    fact: Fact,
    verb: "add" | "remove",
  ): void => {
    if (!isReferenceOnly(fact.id)) {
      deltas.push(verb === "add" ? { verb, fact } : { verb, fact });
      // Emit edge deltas for the (dis)appearing fact too, mirroring compareFact
      // for changed facts: an added subtree's outgoing edges are new `link`s, a
      // removed subtree's are `unlink`s. Edge-driven actions (e.g. owner →
      // ALTER … OWNER TO, move 2) must fire on create/drop, not only on change.
      for (const edge of fb.outgoingEdges(fact.id)) {
        deltas.push(
          verb === "add" ? { verb: "link", edge } : { verb: "unlink", edge },
        );
      }
    }
    for (const child of fb.childrenOf(fact.id)) emitSubtree(fb, child, verb);
  };

  const compareFact = (id: StableId): void => {
    if (isReferenceOnly(id)) return; // present for reference, never diffed
    const factA = a.get(id);
    const factB = b.get(id);
    if (factA && factB) {
      // payload attributes
      if (a.hashOf(id) !== b.hashOf(id)) {
        const keys = new Set([
          ...Object.keys(factA.payload),
          ...Object.keys(factB.payload),
        ]);
        for (const attr of [...keys].sort()) {
          // keys starting with `_` are non-semantic metadata (see hash.ts):
          // extraction-only / version-dependent values carried for the planner,
          // never diffed — they have no attribute rule and would otherwise throw.
          if (attr.startsWith("_")) continue;
          const from = factA.payload[attr];
          const to = factB.payload[attr];
          const fromC = from === undefined ? " absent" : canonicalize(from);
          const toC = to === undefined ? " absent" : canonicalize(to);
          if (fromC !== toC) deltas.push({ verb: "set", id, attr, from, to });
        }
      }
      // outgoing edges
      const edgesA = new Map(a.outgoingEdges(id).map((e) => [edgeKey(e), e]));
      const edgesB = new Map(b.outgoingEdges(id).map((e) => [edgeKey(e), e]));
      for (const [key, edge] of edgesA) {
        if (!edgesB.has(key)) deltas.push({ verb: "unlink", edge });
      }
      for (const [key, edge] of edgesB) {
        if (!edgesA.has(key)) deltas.push({ verb: "link", edge });
      }
    }
  };

  const compareSubtree = (id: StableId): void => {
    const inA = a.has(id);
    const inB = b.has(id);
    if (inA && inB && a.rollupOf(id) === b.rollupOf(id)) return; // skip subtree
    if (inA && !inB) {
      emitSubtree(a, a.get(id) as Fact, "remove");
      return;
    }
    if (!inA && inB) {
      emitSubtree(b, b.get(id) as Fact, "add");
      return;
    }
    compareFact(id);
    const childIds = new Map<string, StableId>();
    if (inA)
      for (const c of a.childrenOf(id)) childIds.set(encodeId(c.id), c.id);
    if (inB)
      for (const c of b.childrenOf(id)) childIds.set(encodeId(c.id), c.id);
    for (const childId of childIds.values()) compareSubtree(childId);
  };

  const rootIds = new Map<string, StableId>();
  for (const r of a.roots()) rootIds.set(encodeId(r.id), r.id);
  for (const r of b.roots()) rootIds.set(encodeId(r.id), r.id);
  for (const id of rootIds.values()) compareSubtree(id);

  // Decorate-sort-undecorate: `sortKey` builds a string via `encodeId`, and a
  // bare comparator recomputes it O(n log n) times. Keys are computed once
  // here. The comparator also returns 0 on equality (the previous `< ? -1 : 1`
  // form was inconsistent for equal keys, so ties resolved arbitrarily); ties
  // now keep emission order, which is the deterministic descent order.
  const keyed = deltas.map((delta) => ({ key: sortKey(delta), delta }));
  keyed.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
  return keyed.map((entry) => entry.delta);
}

/** The StableId a delta is "about" — the fact for add/remove, the id carried
 *  by a set, or the edge's `from` for link/unlink. Exported so a consumer
 *  outside the differ (e.g. `plan()`'s unreadable-user-mapping gate) can match
 *  deltas against a subject without re-deriving this per verb. */
export function subjectOf(d: Delta): StableId {
  switch (d.verb) {
    case "add":
    case "remove":
      return d.fact.id;
    case "set":
      return d.id;
    case "link":
    case "unlink":
      return d.edge.from;
  }
}

function sortKey(d: Delta): string {
  const attr =
    d.verb === "set"
      ? d.attr
      : d.verb === "link" || d.verb === "unlink"
        ? edgeKey(d.edge)
        : "";
  return `${encodeId(subjectOf(d))}|${d.verb}|${attr}`;
}
