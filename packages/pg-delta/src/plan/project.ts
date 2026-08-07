/**
 * Projected plan target (docs/archive/hardening-plan.md Item 1; review
 * #2).
 *
 * `filterDeltas` (policy) removes deltas the plan will NOT apply, but the plan
 * still has a real target: the state reached by applying only the KEPT deltas.
 * That state is `desired` with every FILTERED delta reverted to its source
 * value. Fingerprinting and proving against THIS — not full `desired` — removes
 * the ambiguity "is the plan proving against desired, or desired-through-policy?"
 *
 * No `source` argument is needed: each delta carries its source-side data
 * (a `remove` carries the source fact, a `set` carries `from`, an `unlink`
 * carries the source edge), so the revert is fully determined by `desired` +
 * the filtered deltas.
 */
import type { Delta } from "../core/diff.ts";
import {
  buildFactBase,
  type DependencyEdge,
  type Fact,
  type FactBase,
  retainOwnerRoleDangling,
} from "../core/fact.ts";
import type { Payload } from "../core/hash.ts";
import { encodeId } from "../core/stable-id.ts";

const edgeKey = (e: DependencyEdge): string =>
  `${encodeId(e.from)}|${e.kind}|${encodeId(e.to)}`;

export function projectTarget(
  desired: FactBase,
  filteredDeltas: Delta[],
): FactBase {
  if (filteredDeltas.length === 0) return desired;

  const facts = new Map<string, Fact>(
    desired.facts().map((f) => [encodeId(f.id), f]),
  );
  const edges = new Map<string, DependencyEdge>(
    desired.edges.map((e) => [edgeKey(e), e]),
  );

  for (const d of filteredDeltas) {
    switch (d.verb) {
      case "add": // not added → absent from the target
        facts.delete(encodeId(d.fact.id));
        break;
      case "remove": // not dropped → the source fact stays in the target
        facts.set(encodeId(d.fact.id), d.fact);
        break;
      case "set": {
        // attribute not changed → revert to the source value (`from`)
        const key = encodeId(d.id);
        const cur = facts.get(key);
        if (cur === undefined) break;
        const payload: Payload = { ...cur.payload, [d.attr]: d.from };
        facts.set(key, { ...cur, payload });
        break;
      }
      case "link": // edge not added → absent from the target
        edges.delete(edgeKey(d.edge));
        break;
      case "unlink": // edge not removed → the source edge stays in the target
        edges.set(edgeKey(d.edge), d.edge);
        break;
    }
  }

  // Integrity: a filtered subtree must not orphan a surviving child. Drop facts
  // whose parent is now missing (transitively), then prune edges whose
  // endpoints are gone (mirrors subtractBaseline / excludeManaged cleanup).
  // Reverse-BFS from the facts that are ALREADY orphaned, rather than
  // re-scanning every fact once per round: index children by parent key, seed
  // the worklist with the initial orphans, and cascade to their children as
  // each one is deleted. Same fixpoint (a fact dies iff its parent chain no
  // longer reaches a present root), same surviving Map insertion order — only
  // deletions happen — at O(affected) instead of O(rounds × facts).
  const childKeysOf = new Map<string, string[]>();
  const orphans: string[] = [];
  for (const [key, fact] of facts) {
    if (fact.parent === undefined) continue;
    const parentKey = encodeId(fact.parent);
    if (facts.has(parentKey)) {
      const siblings = childKeysOf.get(parentKey);
      if (siblings === undefined) childKeysOf.set(parentKey, [key]);
      else siblings.push(key);
    } else {
      orphans.push(key);
    }
  }
  while (orphans.length > 0) {
    const key = orphans.pop() as string;
    if (!facts.delete(key)) continue; // already removed via another path
    for (const child of childKeysOf.get(key) ?? []) orphans.push(child);
  }
  for (const [key, edge] of edges) {
    const fromPresent = facts.has(encodeId(edge.from));
    const toPresent = facts.has(encodeId(edge.to));
    if (fromPresent && toPresent) continue;
    // Ownership carve-out: a retained dangling owner→role edge (database scope)
    // keeps its role endpoint absent by design — preserve it so the projected
    // target (fingerprint + proof) still reflects the serialized OWNER TO, rather
    // than pruning it and drifting from the applied result.
    if (fromPresent && retainOwnerRoleDangling(edge)) continue;
    edges.delete(key);
  }

  return buildFactBase(
    [...facts.values()],
    [...edges.values()],
    desired.source,
    // referenceOnly is intentionally NOT carried forward here (unchanged from the
    // original 3-arg call); the 4th arg is supplied only to reach `allowDangling`.
    new Set(),
    { allowDangling: retainOwnerRoleDangling },
  );
}
