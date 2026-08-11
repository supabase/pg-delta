/**
 * The fact base: a normalized, content-addressed relation
 * (target-architecture §3.1).
 *
 * Every addressable thing is its own fact with a parent *relation*;
 * hierarchy is a view. Payloads are identity-free (enforced upstream at
 * payload construction): a fact's own name lives in its id, never in what
 * is hashed.
 */
import type { Diagnostic } from "./diagnostic.ts";
import {
  contentHash,
  hashString,
  type ContentHash,
  type Payload,
} from "./hash.ts";
import { encodeIdMemo, encodeIdRegister, type StableId } from "./stable-id.ts";

export interface Fact {
  id: StableId;
  parent?: StableId;
  payload: Payload;
}

/** Where a fact base came from. Provenance is metadata, NOT state: it never
 *  enters the rollup hash, so two bases with identical facts compare equal
 *  regardless of source. Policy (§3.9) and frontends use it for routing. */
export type FactSource = "liveDb" | "sqlFiles" | "snapshot";

export type EdgeKind = "depends" | "owner" | "memberOfExtension" | "managedBy";

export interface DependencyEdge {
  /** The dependent object (must be torn down before / built after `to`). */
  from: StableId;
  /** The referenced object. */
  to: StableId;
  kind: EdgeKind;
}

/**
 * The single `allowDangling` predicate for the ownership-serialization carve-out.
 *
 * `projectManagementScope("database")` removes cluster-global role facts but
 * DELIBERATELY retains each surviving object's `owner` edge to a removed role as a
 * dangling ASSUMED reference, so ownership still serializes as `ALTER … OWNER TO`.
 * EVERY reconstruction that can carry such a view forward (`resolveView`'s
 * reference-only rebuild, `excludeFactsAndDescendants`, `projectTarget`, the scope
 * projection itself) must use THIS predicate, or the rebuild silently re-prunes
 * the retained edge and the export emits zero `OWNER TO` (regression: extensions /
 * assumed schemas force the rebuild that a public-only view never triggered).
 * Centralized here so the rule cannot drift between call sites.
 */
export const retainOwnerRoleDangling = (edge: DependencyEdge): boolean =>
  edge.kind === "owner" && edge.to.kind === "role";

interface Entry {
  fact: Fact;
  encoded: string;
  /** `encodeIdRegister(fact.parent)`, encoded once at index time: the parent chain
   *  is walked by the acyclicity check and every hierarchy lookup. */
  parentKey: string | undefined;
  hash: ContentHash;
}

export class FactBase {
  readonly diagnostics: Diagnostic[] = [];
  /** provenance; metadata only, never folded into rollups */
  readonly source: FactSource;
  /**
   * Encoded ids of facts that are present for REFERENCE ONLY — kept in the view
   * so managed dependents can resolve them (e.g. a platform `auth.users` so a
   * user trigger on it has a parent), but never diffed (no add/remove/set/edge
   * delta). Set by the managed-view projection (resolveView) for objects in a
   * policy's `assumedSchemas`. Empty for raw extraction and the corpus.
   */
  readonly referenceOnly: ReadonlySet<string>;
  readonly #byId = new Map<string, Entry>();
  readonly #children = new Map<string, Entry[]>();
  readonly #outgoing = new Map<string, DependencyEdge[]>();
  readonly #incoming = new Map<string, DependencyEdge[]>();
  /** Per-source rollup fragments (`from-[kind]->to`), built from the endpoint
   *  keys the edge loop already encoded so `#rollup` never re-encodes them. */
  readonly #outgoingParts = new Map<string, string[]>();
  #edges: DependencyEdge[] = [];
  readonly #rollups = new Map<string, ContentHash>();
  readonly #structural = new Map<string, ContentHash>();
  #rootHash: ContentHash | undefined;

  constructor(
    facts: Fact[],
    edges: DependencyEdge[],
    source: FactSource = "liveDb",
    referenceOnly: ReadonlySet<string> = new Set(),
    /** Opt-in allowance for a projection that DELIBERATELY retains an edge whose
     *  endpoint it just removed — e.g. `projectManagementScope("database")` keeps
     *  an `owner` edge to a scope-projected role as an ASSUMED reference so
     *  ownership still serializes as `ALTER … OWNER TO`. When `allowDangling(edge)`
     *  is true the edge is retained WITHOUT a `dangling_edge` diagnostic and
     *  indexed only on whichever endpoint is present. Default: every dangling edge
     *  is silently pruned (extraction relies on this for non-extracted system
     *  owners), so this narrowly-scoped hook is the single exception. */
    opts: { allowDangling?: (edge: DependencyEdge) => boolean } = {},
  ) {
    this.source = source;
    this.referenceOnly = referenceOnly;
    // This indexing pass is the SOLE writer of the id-encoding memo: these ids
    // (fact ids, their parents, edge endpoints) are engine-owned and never mutated
    // after construction, so caching them is sound. A public lookup's query object
    // must never be cached, which is why every accessor below reads the memo via
    // `encodeIdMemo` and only this loop writes via `encodeIdRegister`.
    for (const fact of facts) {
      const encoded = encodeIdRegister(fact.id);
      if (this.#byId.has(encoded)) {
        throw new Error(`FactBase: duplicate fact id ${encoded}`);
      }
      this.#byId.set(encoded, {
        fact,
        encoded,
        parentKey:
          fact.parent === undefined ? undefined : encodeIdRegister(fact.parent),
        hash: contentHash(fact.payload),
      });
    }
    for (const entry of this.#byId.values()) {
      const parentKey = entry.parentKey;
      if (parentKey === undefined) continue;
      if (!this.#byId.has(parentKey)) {
        throw new Error(
          `FactBase: fact ${entry.encoded} references missing parent ${parentKey}`,
        );
      }
      const siblings = this.#children.get(parentKey) ?? [];
      siblings.push(entry);
      this.#children.set(parentKey, siblings);
    }
    for (const children of this.#children.values()) {
      children.sort((a, b) => (a.encoded < b.encoded ? -1 : 1));
    }
    // Acyclicity / root-reachability. The missing-parent check above only
    // proves every parent EXISTS; a self-parent or parent cycle passes it (each
    // member's parent is present) yet reaches no parentless root, so roots()
    // omits the whole component and rootHash fingerprints like a base that does
    // not contain it — a poisoned base that diff() silently never descends into.
    // Reject it here. Single pass, memoized reachability (O(n), no recursion).
    const reachesRoot = new Set<string>(); // encoded ids known to reach a root
    // One scratch pair reused across starts: at catalog scale the per-fact
    // array + Set allocation dominated the walk itself (most chains break out
    // on the first hop into `reachesRoot`).
    const path: string[] = [];
    const onPath = new Set<string>();
    for (const start of this.#byId.values()) {
      if (reachesRoot.has(start.encoded)) continue;
      path.length = 0;
      onPath.clear();
      let cursor: Entry | undefined = start;
      while (cursor !== undefined) {
        if (reachesRoot.has(cursor.encoded)) break; // joins a known-good chain
        if (onPath.has(cursor.encoded)) {
          const from = path.indexOf(cursor.encoded);
          const members = [...path.slice(from), cursor.encoded];
          throw new Error(
            `FactBase: parent cycle (no root) among facts ${members.join(" -> ")}`,
          );
        }
        onPath.add(cursor.encoded);
        path.push(cursor.encoded);
        if (cursor.parentKey === undefined) break; // reached a parentless root
        // parent presence was validated above, so this is always defined
        cursor = this.#byId.get(cursor.parentKey);
      }
      for (const key of path) reachesRoot.add(key);
    }
    for (const edge of edges) {
      const fromKey = encodeIdRegister(edge.from);
      const toKey = encodeIdRegister(edge.to);
      const fromPresent = this.#byId.has(fromKey);
      const toPresent = this.#byId.has(toKey);
      if (!fromPresent || !toPresent) {
        if (opts.allowDangling?.(edge)) {
          // deliberately retained dangling edge (assumed reference): keep it and
          // index only the present endpoint(s); no diagnostic.
          this.#edges.push(edge);
          if (fromPresent) {
            this.#indexOutgoing(fromKey, toKey, edge);
          }
          if (toPresent) {
            const inList = this.#incoming.get(toKey) ?? [];
            inList.push(edge);
            this.#incoming.set(toKey, inList);
          }
          continue;
        }
        this.diagnostics.push({
          code: "dangling_edge",
          severity: "warning",
          subject: fromPresent ? edge.to : edge.from,
          message: `edge ${fromKey} -[${edge.kind}]-> ${toKey} references a fact not in the base`,
        });
        continue;
      }
      this.#edges.push(edge);
      this.#indexOutgoing(fromKey, toKey, edge);
      const inList = this.#incoming.get(toKey) ?? [];
      inList.push(edge);
      this.#incoming.set(toKey, inList);
    }
  }

  #indexOutgoing(fromKey: string, toKey: string, edge: DependencyEdge): void {
    const outList = this.#outgoing.get(fromKey) ?? [];
    outList.push(edge);
    this.#outgoing.set(fromKey, outList);
    const parts = this.#outgoingParts.get(fromKey) ?? [];
    parts.push(`${fromKey}-[${edge.kind}]->${toKey}`);
    this.#outgoingParts.set(fromKey, parts);
  }

  get edges(): readonly DependencyEdge[] {
    return this.#edges;
  }

  /** O(1) fact lookup by its already-encoded id (avoids decode + facts().find).
   *  Consumers holding an encoded key use this instead of scanning facts(). */
  getByEncoded(encoded: string): Fact | undefined {
    return this.#byId.get(encoded)?.fact;
  }

  facts(): Fact[] {
    return [...this.#byId.values()].map((e) => e.fact);
  }

  get(id: StableId): Fact | undefined {
    return this.#byId.get(encodeIdMemo(id))?.fact;
  }

  has(id: StableId): boolean {
    return this.#byId.has(encodeIdMemo(id));
  }

  /** Whether `id` is present for REFERENCE ONLY (see `referenceOnly`). Satisfies
   *  the `FactView` member so a rule can distinguish "on the target" from
   *  "produced by this plan". */
  isReferenceOnly(id: StableId): boolean {
    return this.referenceOnly.has(encodeIdMemo(id));
  }

  hashOf(id: StableId): ContentHash {
    const entry = this.#byId.get(encodeIdMemo(id));
    if (!entry) throw new Error(`FactBase: unknown fact ${encodeIdMemo(id)}`);
    return entry.hash;
  }

  childrenOf(id: StableId): Fact[] {
    return (this.#children.get(encodeIdMemo(id)) ?? []).map((e) => e.fact);
  }

  outgoingEdges(id: StableId): readonly DependencyEdge[] {
    return this.#outgoing.get(encodeIdMemo(id)) ?? [];
  }

  /** Edges pointing AT `id` (reverse index): the facts that depend on it. Used
   *  by the planner's forced-rebuild reachability walk (O(reachable) instead of
   *  rescanning every edge each round). */
  incomingEdges(id: StableId): readonly DependencyEdge[] {
    return this.#incoming.get(encodeIdMemo(id)) ?? [];
  }

  /** Reverse edges by already-encoded id (avoids re-encoding in hot walks). */
  incomingEdgesByEncoded(encoded: string): readonly DependencyEdge[] {
    return this.#incoming.get(encoded) ?? [];
  }

  /** Roots: facts with no parent, sorted by encoded id. */
  roots(): Fact[] {
    return [...this.#byId.values()]
      .filter((e) => e.fact.parent === undefined)
      .sort((a, b) => (a.encoded < b.encoded ? -1 : 1))
      .map((e) => e.fact);
  }

  /**
   * Named Merkle rollup: payload hash + (childId=childRollup) pairs sorted
   * by child id + outgoing edge hashes sorted. Identity changes in the
   * subtree propagate (a renamed child changes the parent's rollup).
   */
  rollupOf(id: StableId): ContentHash {
    return this.#rollup(encodeIdMemo(id));
  }

  #rollup(key: string): ContentHash {
    const cached = this.#rollups.get(key);
    if (cached !== undefined) return cached;
    const entry = this.#byId.get(key);
    if (!entry) throw new Error(`FactBase: unknown fact ${key}`);
    const childParts = (this.#children.get(key) ?? []).map(
      (c) => `${c.encoded}=${this.#rollup(c.encoded)}`,
    );
    // sorted in place: the fragments are private to the rollup fold, and
    // `#rollups` memoizes the result so this runs once per key
    const edgeParts = (this.#outgoingParts.get(key) ?? []).sort();
    const rollup = hashString(
      `F|${entry.hash}|C|${childParts.join(",")}|E|${edgeParts.join(",")}`,
    );
    this.#rollups.set(key, rollup);
    return rollup;
  }

  /**
   * Structural rollup: identity-free fold (payload hashes + child structural
   * rollups sorted by value; edges excluded — they embed identities). Used
   * for container rename matching (§4.1).
   */
  structuralRollupOf(id: StableId): ContentHash {
    return this.#structuralRollup(encodeIdMemo(id));
  }

  #structuralRollup(key: string): ContentHash {
    const cached = this.#structural.get(key);
    if (cached !== undefined) return cached;
    const entry = this.#byId.get(key);
    if (!entry) throw new Error(`FactBase: unknown fact ${key}`);
    const childParts = (this.#children.get(key) ?? [])
      .map((c) => this.#structuralRollup(c.encoded))
      .sort();
    const rollup = hashString(`S|${entry.hash}|C|${childParts.join(",")}`);
    this.#structural.set(key, rollup);
    return rollup;
  }

  /** The fingerprint of the whole state: (rootId=rollup) pairs, sorted.
   *  NOTE: this folds EVERY fact, including `referenceOnly` assumed-schema facts.
   *  The apply fingerprint gate relies on that (a plan is only applicable against
   *  the same baseline) — see the "KNOWN PITFALL" note in apply.ts. */
  get rootHash(): ContentHash {
    if (this.#rootHash === undefined) {
      const parts = this.roots().map(
        (f) => `${encodeIdMemo(f.id)}=${this.rollupOf(f.id)}`,
      );
      this.#rootHash = hashString(`ROOT|${parts.join(",")}`);
    }
    return this.#rootHash;
  }
}

export function buildFactBase(
  facts: Fact[],
  edges: DependencyEdge[],
  source: FactSource = "liveDb",
  referenceOnly: ReadonlySet<string> = new Set(),
  opts: { allowDangling?: (edge: DependencyEdge) => boolean } = {},
): FactBase {
  return new FactBase(facts, edges, source, referenceOnly, opts);
}
