/**
 * Planner phase 4 — ActionGraph (target-architecture §3.5–3.6).
 *
 * Turns the emitted action list into a deterministically ordered, compacted
 * final list plus the aggregated safety report. Pure over its inputs (the
 * emitted actions + producer/destroyer indexes + the two fact bases); the graph
 * construction, topo sort, segment-boundary marking, and compaction building
 * blocks live in ../internal.ts. Extracted so the ordering/compaction stage is a
 * named phase boundary rather than a tail of `plan()`.
 */
import type { FactBase } from "../../core/fact.ts";
import type { Action, SafetyReport } from "../plan.ts";
import { topoSort } from "../graph.ts";
import type { StableId } from "../../core/stable-id.ts";
import type { ApplierCapability } from "../../policy/capability.ts";
import type { RulesForId } from "../rules.ts";
import {
  actionTieKey,
  buildActionGraph,
  compactColumnFolds,
  computeSafetyReport,
  elideCascadeSubsumedPolicyDrops,
  elideCoCreateRevokeBeforeGrant,
  elideDefaultAclCreates,
  elideRedundantDrops,
  foldCoCreateOwnership,
} from "../internal.ts";

export interface FinalizeInput {
  actions: Action[];
  producerOf: ReadonlyMap<string, number>;
  destroyerOf: ReadonlyMap<string, number>;
  /** resolved source / desired views (NOT the projected target): graph build
   *  order reads desired edges, teardown reads source edges. */
  source: FactBase;
  desired: FactBase;
  renameActionIndices: ReadonlySet<number>;
  /** per-action compaction metadata captured during emission (never persisted). */
  foldHints: ReadonlyArray<{ foldInto: StableId; clause: string } | undefined>;
  acceptsFolds: readonly boolean[];
  /** policy-declared roles assumed to exist at apply time (e.g. Supabase
   *  anon/authenticated) — exempt from the missing-requirement guard just like
   *  the `pg_` prefix and PUBLIC. Empty under the raw/no-policy path. */
  assumedRoleNames: ReadonlySet<string>;
  /** policy-declared schemas assumed to exist at apply time (e.g. Supabase's
   *  `extensions`) — exempt from the missing-requirement guard like the assumed
   *  roles. Empty under the raw/no-policy path. */
  assumedSchemaNames: ReadonlySet<string>;
  /** applier capability (move 6) — needed by the co-create compaction passes:
   *  the owner-ALTER no-op elision and the REVOKE-before-GRANT superset guard key
   *  off `capability.role`. Undefined under the unrestricted (superuser/CI/raw)
   *  path, where those capability-gated elisions stay conservative. */
  capability: ApplierCapability | undefined;
  /** §3.6 compaction; cosmetic-by-contract (proof unchanged). Default true. */
  compact: boolean;
  /** Export-only constraint folding: apply the constraint rules' inline-fold
   *  hints (CONSTRAINT name <def> into the table's CREATE parens), excluding
   *  the given encoded constraint ids (cycle-participating FKs). Undefined
   *  (the default, and every non-export path) leaves those hints inert. */
  foldConstraints: { exclude?: ReadonlySet<string> } | undefined;
  /** id-keyed rule resolver (schema kinds + `extensionIntent`), used by the
   *  tie-break so intent actions sort on their declared late weight. */
  rulesForId: RulesForId;
}

export interface FinalizeOutput {
  actions: Action[];
  safetyReport: SafetyReport;
}

/**
 * Order, segment-mark, and compact the emitted actions; compute the safety
 * report. Behavior-preserving extraction of `plan()`'s graph/order/compaction
 * tail.
 */
export function finalizeActions(input: FinalizeInput): FinalizeOutput {
  const {
    actions,
    producerOf,
    destroyerOf,
    source,
    desired,
    renameActionIndices,
    foldHints,
    acceptsFolds,
    assumedRoleNames,
    assumedSchemaNames,
    capability,
    compact,
    foldConstraints,
    rulesForId,
  } = input;

  // ── graph edges + deterministic order ─────────────────────────────────
  const edges = buildActionGraph(
    actions,
    producerOf,
    destroyerOf,
    source,
    desired,
    renameActionIndices,
    assumedRoleNames,
    assumedSchemaNames,
  );

  const order = topoSort(
    actions.length,
    edges,
    (i) => actionTieKey(actions, i, rulesForId),
    (i) => (actions[i] as Action).sql,
  );

  // ── commitBoundaryAfter segment boundary (§3.8) ───────────────────────
  // Mark the FIRST graph successor of each commitBoundaryAfter action with
  // newSegmentBefore. apply.ts already closes the segment unconditionally after
  // a commitBoundaryAfter action (review #6), so this flag's load-bearing role
  // now is COMPACTION PROTECTION — compaction refuses to fold a clause across a
  // newSegmentBefore boundary. This loop is the sole producer of the flag.
  const positionOf = Array.from({ length: actions.length }, () => 0);
  order.forEach((actionIndex, position) => {
    positionOf[actionIndex] = position;
  });
  const orderedActions = order.map((i) => actions[i] as Action);
  for (let u = 0; u < actions.length; u++) {
    if ((actions[u] as Action).transactionality !== "commitBoundaryAfter")
      continue;
    let firstConsumerPos = Number.POSITIVE_INFINITY;
    for (const [a, b] of edges) {
      if (a !== u) continue;
      const pos = positionOf[b] as number;
      if (pos < firstConsumerPos) firstConsumerPos = pos;
    }
    if (Number.isFinite(firstConsumerPos)) {
      (orderedActions[firstConsumerPos] as Action).newSegmentBefore = true;
    }
  }

  // ── compaction (§3.6) ─────────────────────────────────────────────────
  // fold ADD COLUMN clauses into their bare CREATE TABLE (no edge may cross the
  // merge), drop a replace's redundant drop when the create reproduces the
  // identical statement, elide REVOKE/GRANT pairs that only re-materialize a
  // freshly-created object's built-in default ACL, trim the cosmetic leading
  // REVOKE off remaining third-party co-create grants, then fold a co-created
  // object's owner ALTER into its CREATE (CREATE SCHEMA … AUTHORIZATION, or drop
  // an applier-redundant ALTER). Purely cosmetic — the proof is unchanged.
  const finalActions = compact
    ? foldCoCreateOwnership(
        elideCoCreateRevokeBeforeGrant(
          elideDefaultAclCreates(
            elideCascadeSubsumedPolicyDrops(
              elideRedundantDrops(
                compactColumnFolds(
                  orderedActions,
                  order,
                  edges,
                  foldHints,
                  acceptsFolds,
                  positionOf,
                  foldConstraints,
                ),
                source,
              ),
              source,
            ),
            desired,
            capability,
          ),
          desired,
          capability,
        ),
        desired,
        capability,
      )
    : orderedActions;

  return {
    actions: finalActions,
    safetyReport: computeSafetyReport(finalActions),
  };
}
