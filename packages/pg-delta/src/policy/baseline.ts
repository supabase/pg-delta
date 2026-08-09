/**
 * Baseline subtraction: remove facts present-and-identical in the baseline
 * from a FactBase (target-architecture §3.9, stage-08-policy).
 *
 * "Diff against the platform baseline" = set subtraction before planning.
 * Facts present in the baseline with the same payload hash are dropped from
 * both sides, replacing hand-maintained empty-catalog special cases.
 *
 * Parent-chain preservation: if a fact survives (its hash differs from the
 * baseline or it is new), all its ancestors must also survive so that
 * FactBase construction never encounters a missing parent.
 *
 * Edge pruning: edges whose either endpoint was removed are silently dropped
 * (they become dangling, so FactBase would warn about them; we prune them
 * here instead).
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  buildFactBase,
  type DependencyEdge,
  type Fact,
  type FactBase,
  retainOwnerRoleDangling,
} from "../core/fact.ts";
import { encodeId, type StableId } from "../core/stable-id.ts";
import { deserializeSnapshot } from "../core/snapshot.ts";

/**
 * Return a new FactBase containing only facts that are NOT present with an
 * identical payload hash in `baseline`.
 *
 * A fact is "identical in the baseline" when:
 *   - encodeId(fact.id) exists in baseline, AND
 *   - baseline.hashOf(fact.id) === fb.hashOf(fact.id)
 *
 * Parent-chain rule: any ancestor of a surviving fact is also kept, even if
 * it would otherwise be subtracted, so that FactBase construction succeeds.
 *
 * Edge rule: only edges whose both endpoints survive are kept.
 */
export function subtractBaseline(fb: FactBase, baseline: FactBase): FactBase {
  const allFacts = fb.facts();

  // Phase 1: mark each fact as "would subtract" (present-and-identical in
  // baseline). "Identical" means BOTH the payload hash AND the outgoing-edge
  // signature match — an equal-payload fact whose outgoing edge changed (e.g.
  // `owner` A→B, or a `depends`/`memberOfExtension` provenance edge) is a real
  // change and must NOT be subtracted, or the drift would be pruned invisibly.
  const wouldSubtract = new Set<string>();
  for (const fact of allFacts) {
    const encoded = encodeId(fact.id);
    if (
      baseline.has(fact.id) &&
      baseline.hashOf(fact.id) === fb.hashOf(fact.id) &&
      edgeSignature(baseline, fact.id) === edgeSignature(fb, fact.id)
    ) {
      wouldSubtract.add(encoded);
    }
  }

  // Phase 2: walk every fact that survives and ensure its parent chain survives
  // Collect surviving encoded ids first (those not in wouldSubtract)
  const surviving = new Set<string>();
  for (const fact of allFacts) {
    const encoded = encodeId(fact.id);
    if (!wouldSubtract.has(encoded)) {
      surviving.add(encoded);
    }
  }

  // For each surviving fact, walk up the parent chain and force-add ancestors
  const toForceKeep = new Set<string>();
  for (const fact of allFacts) {
    const encoded = encodeId(fact.id);
    if (!surviving.has(encoded)) continue;
    // Walk parent chain
    let current = fact.parent;
    while (current !== undefined) {
      const parentEncoded = encodeId(current);
      if (surviving.has(parentEncoded)) break; // already in surviving
      if (toForceKeep.has(parentEncoded)) break; // already force-kept
      toForceKeep.add(parentEncoded);
      const parentFact = fb.get(current);
      current = parentFact?.parent;
    }
  }

  // Final surviving set = surviving ∪ toForceKeep
  const finalSurviving = new Set<string>([...surviving, ...toForceKeep]);

  // Phase 3: collect surviving facts (preserving original order for determinism)
  const keptFacts: Fact[] = [];
  for (const fact of allFacts) {
    if (finalSurviving.has(encodeId(fact.id))) {
      keptFacts.push(fact);
    }
  }

  // Phase 4: collect edges. Keep an edge when both endpoints survive, OR when it
  // is an `owner -> role` edge whose OWNED endpoint survives — that role may have
  // been subtracted (a platform baseline role), but ownership must still
  // serialize as `ALTER … OWNER TO` the assumed role, so the edge is retained as
  // a dangling assumed reference (retainOwnerRoleDangling). Role endpoint facts
  // are NOT force-kept, and a `depends`/`memberOfExtension`/`managedBy` edge to a
  // subtracted endpoint stays pruned as before.
  const keptEdges: DependencyEdge[] = [];
  for (const edge of fb.edges) {
    const fromEncoded = encodeId(edge.from);
    const toEncoded = encodeId(edge.to);
    const bothSurvive =
      finalSurviving.has(fromEncoded) && finalSurviving.has(toEncoded);
    if (
      bothSurvive ||
      (retainOwnerRoleDangling(edge) && finalSurviving.has(fromEncoded))
    ) {
      keptEdges.push(edge);
    }
  }

  // rootHash already folds each fact's outgoing edges (fact.ts #rollup), so a
  // retained dangling owner edge is reflected in the digest — no separate digest
  // change is needed. `allowDangling: retainOwnerRoleDangling` lets FactBase keep
  // the retained owner->role edge without a `dangling_edge` diagnostic.
  return buildFactBase(keptFacts, keptEdges, "liveDb", new Set(), {
    allowDangling: retainOwnerRoleDangling,
  });
}

/**
 * The outgoing-edge signature of `id` in `fb`: the sorted `${kind}->${to}` list
 * over ALL four edge kinds. Two facts with equal payloads still differ when an
 * outgoing edge changed, so baseline subtraction compares this alongside the
 * payload hash. Mirrors what `FactBase.#rollup` folds (payload + outgoing edges)
 * but deliberately does NOT fold children — reusing `rollupOf` would let a
 * changed child wrongly resurrect an otherwise-identical parent.
 */
function edgeSignature(fb: FactBase, id: StableId): string {
  return fb
    .outgoingEdges(id)
    .map((e) => `${e.kind}->${encodeId(e.to)}`)
    .sort()
    .join("|");
}

/**
 * A baseline loaded from a `pgdelta snapshot` file, carrying the metadata a
 * caller needs to keep the managed view consistent across commands:
 *   - `factBase`  — the facts to subtract (fed to `subtractBaseline`);
 *   - `digest`    — the snapshot's verified content hash (`factBase.rootHash`),
 *                   stamped on plan artifacts / export manifests and reconciled
 *                   at apply/prove time so a swapped or edited baseline fails
 *                   loud instead of silently diffing a different view;
 *   - `redactSecrets` — the redaction mode the snapshot was captured with, so a
 *                   command extracting in a DIFFERENT mode can reject the
 *                   mismatch (redacted vs unredacted payloads hash differently,
 *                   so the baseline would silently stop subtracting);
 *   - `path`      — source path, for diagnostics.
 */
export interface LoadedBaseline {
  readonly factBase: FactBase;
  readonly digest: string;
  readonly redactSecrets?: boolean;
  readonly path?: string;
}

/**
 * Load a baseline from a snapshot JSON file at the given path, with the digest
 * and redaction metadata needed for cross-command reconciliation.
 *
 * Uses node:fs (synchronous) to read the file, then deserializes via
 * src/core/snapshot.ts. Throws if the file does not exist or the snapshot
 * digest is corrupt (deserializeSnapshot re-verifies the digest on load, so a
 * successful load IS verification).
 */
export function loadBaselineFile(path: string): LoadedBaseline {
  const json = readFileSync(path, "utf-8");
  const snap = deserializeSnapshot(json);
  return {
    factBase: snap.factBase,
    digest: snap.factBase.rootHash,
    ...(snap.redactSecrets !== undefined
      ? { redactSecrets: snap.redactSecrets }
      : {}),
    path,
  };
}

/** Where committed baseline snapshots live (`src/policy/baselines/`). */
const BASELINE_DIR = fileURLToPath(new URL("./baselines/", import.meta.url));

/**
 * Resolve a policy's declared baseline NAME to its committed snapshot FactBase
 * (review finding 3) — the frontend seam that makes a declared baseline ACTUAL.
 *
 * Convention: `<dir>/<baseline>-<pgMajor>.json`, falling back to
 * `<dir>/<baseline>.json`. Returns `undefined` when the policy declares no
 * baseline.
 *
 * Fail-loud: if the policy DOES declare a baseline but no snapshot is committed,
 * this THROWS rather than returning undefined — a declared baseline must never
 * be silently ignored. (Until the platform baselines are committed — a separate
 * v1 validation item — this is the expected behaviour for a policy that sets
 * `baseline`.)
 */
export function resolveBaseline(
  policy: { id: string; baseline?: string },
  opts: { pgMajor: number; dir?: string },
): LoadedBaseline | undefined {
  if (policy.baseline === undefined) return undefined;
  const dir = opts.dir ?? BASELINE_DIR;
  const candidates = [
    join(dir, `${policy.baseline}-${opts.pgMajor}.json`),
    join(dir, `${policy.baseline}.json`),
  ];
  for (const path of candidates) {
    if (existsSync(path)) return loadBaselineFile(path);
  }
  throw new Error(
    `policy "${policy.id}" declares baseline "${policy.baseline}" but no baseline ` +
      `snapshot is committed (looked for: ${candidates.join(", ")}). ` +
      `Generate and commit it, or remove the baseline from the policy — ` +
      `a declared baseline must never be silently ignored.`,
  );
}
