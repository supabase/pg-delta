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
import { encodeId, type StableId } from "./stable-id.ts";

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

interface Entry {
  fact: Fact;
  encoded: string;
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
  #edges: DependencyEdge[] = [];
  readonly #rollups = new Map<string, ContentHash>();
  readonly #structural = new Map<string, ContentHash>();
  #rootHash: ContentHash | undefined;

  constructor(
    facts: Fact[],
    edges: DependencyEdge[],
    source: FactSource = "liveDb",
    referenceOnly: ReadonlySet<string> = new Set(),
  ) {
    this.source = source;
    this.referenceOnly = referenceOnly;
    for (const fact of facts) {
      const encoded = encodeId(fact.id);
      if (this.#byId.has(encoded)) {
        throw new Error(`FactBase: duplicate fact id ${encoded}`);
      }
      this.#byId.set(encoded, {
        fact,
        encoded,
        hash: contentHash(fact.payload),
      });
    }
    for (const entry of this.#byId.values()) {
      const parent = entry.fact.parent;
      if (parent === undefined) continue;
      const parentKey = encodeId(parent);
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
    for (const edge of edges) {
      const fromKey = encodeId(edge.from);
      const toKey = encodeId(edge.to);
      if (!this.#byId.has(fromKey) || !this.#byId.has(toKey)) {
        this.diagnostics.push({
          code: "dangling_edge",
          severity: "warning",
          subject: this.#byId.has(fromKey) ? edge.to : edge.from,
          message: `edge ${fromKey} -[${edge.kind}]-> ${toKey} references a fact not in the base`,
        });
        continue;
      }
      this.#edges.push(edge);
      const outList = this.#outgoing.get(fromKey) ?? [];
      outList.push(edge);
      this.#outgoing.set(fromKey, outList);
      const inList = this.#incoming.get(toKey) ?? [];
      inList.push(edge);
      this.#incoming.set(toKey, inList);
    }
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
    return this.#byId.get(encodeId(id))?.fact;
  }

  has(id: StableId): boolean {
    return this.#byId.has(encodeId(id));
  }

  hashOf(id: StableId): ContentHash {
    const entry = this.#byId.get(encodeId(id));
    if (!entry) throw new Error(`FactBase: unknown fact ${encodeId(id)}`);
    return entry.hash;
  }

  childrenOf(id: StableId): Fact[] {
    return (this.#children.get(encodeId(id)) ?? []).map((e) => e.fact);
  }

  outgoingEdges(id: StableId): readonly DependencyEdge[] {
    return this.#outgoing.get(encodeId(id)) ?? [];
  }

  /** Edges pointing AT `id` (reverse index): the facts that depend on it. Used
   *  by the planner's forced-rebuild reachability walk (O(reachable) instead of
   *  rescanning every edge each round). */
  incomingEdges(id: StableId): readonly DependencyEdge[] {
    return this.#incoming.get(encodeId(id)) ?? [];
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
    return this.#rollup(encodeId(id));
  }

  #rollup(key: string): ContentHash {
    const cached = this.#rollups.get(key);
    if (cached !== undefined) return cached;
    const entry = this.#byId.get(key);
    if (!entry) throw new Error(`FactBase: unknown fact ${key}`);
    const childParts = (this.#children.get(key) ?? []).map(
      (c) => `${c.encoded}=${this.#rollup(c.encoded)}`,
    );
    const edgeParts = (this.#outgoing.get(key) ?? [])
      .map((e) => `${encodeId(e.from)}-[${e.kind}]->${encodeId(e.to)}`)
      .sort();
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
    return this.#structuralRollup(encodeId(id));
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
        (f) => `${encodeId(f.id)}=${this.rollupOf(f.id)}`,
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
): FactBase {
  return new FactBase(facts, edges, source, referenceOnly);
}
