/**
 * The planner (target-architecture §3.4–3.6): deltas × rule table → atomic
 * actions → one mixed dependency graph → one deterministic sort.
 */
import { INTENT_UNKEYED } from "../core/diagnostic.ts";
import type { Delta } from "../core/diff.ts";
import type { FactBase } from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import { flattenPolicy, type Policy } from "../policy/policy.ts";
import type { ApplierCapability } from "../policy/capability.ts";
import { emitActions } from "./phases/action-emitter.ts";
import { finalizeActions } from "./phases/action-graph.ts";
import { buildChangeSet } from "./phases/change-set.ts";
import { expandReplacements } from "./phases/replacement-expansion.ts";
import type { LockClass } from "./locks.ts";
import type { RenameCandidate, RenameMode } from "./renames.ts";
import {
  buildRuleResolver,
  type IntentRuleIndex,
  KNOWN_PARAMS,
  type PlanParams,
} from "./rules.ts";

/** Engine version stamped into plan artifacts; apply refuses artifacts
 *  from an engine it does not understand (stage 6 deliverable 1). */
export const ENGINE_VERSION = "0.1.0";

export interface Action {
  sql: string;
  verb: "create" | "alter" | "drop";
  produces: StableId[];
  consumes: StableId[];
  destroys: StableId[];
  /** ids this action stops referencing — must run before their destroyer */
  releases: StableId[];
  /** three-valued transactionality (§3.8) */
  transactionality:
    | "transactional"
    | "nonTransactional"
    | "commitBoundaryAfter";
  /** documented lock level of this DDL form — reported, never certified */
  lockClass: LockClass;
  /** forces a COMMIT before this action. Set on the first consumer of a
   *  commitBoundaryAfter action; consumed BOTH by apply (a segment boundary —
   *  now belt-and-suspenders, since apply also closes the segment
   *  unconditionally after a commitBoundaryAfter action, review #6) AND by
   *  compaction, which must not fold a clause across this boundary
   *  (internal.ts). The latter is its load-bearing role today. */
  newSegmentBefore: boolean;
  dataLoss: "none" | "destructive";
  rewriteRisk: boolean;
}

/** Aggregated per-action safety metadata (§3.7). Lock classes and
 *  rewrite/data-loss counts; the proof loop turns dataLoss into a
 *  verified claim, lock classes stay reported. */
export interface SafetyReport {
  destructiveActions: number;
  rewriteRiskActions: number;
  nonTransactionalActions: number;
  lockClasses: Partial<Record<LockClass, number>>;
}

export interface Plan {
  formatVersion: 1;
  engineVersion: string;
  source: { fingerprint: string };
  target: { fingerprint: string };
  /** whether the source/desired fact bases were extracted with secret redaction
   *  on (the extract default). Stamped by the CLI so `apply`/`prove` re-extract
   *  the target with the SAME redaction mode for the fingerprint gate: a plan
   *  fingerprinted over unredacted secrets (`--unsafe-show-secrets`) would
   *  otherwise mismatch a default-redacted re-extract and fail the gate. Absent
   *  on direct library plans (corpus), which apply treats as the default (on). */
  redactSecrets?: boolean;
  /** session settings the executor applies per transaction segment —
   *  explicit plan metadata, not loose SQL in the action list */
  preamble: { name: string; value: string }[];
  deltas: Delta[];
  /** deltas the policy filtered out — reported, never silently absent
   *  (§3.9): drift the user chose not to manage is still drift they can
   *  ask about */
  filteredDeltas: Delta[];
  /** the policy that shaped this plan, inlined for reproducibility */
  policy?: Policy;
  /** the applier capability the plan was produced with (move 6 / follow-up 2),
   *  inlined so a later prove/apply recovers the SAME view. `memberOf` is an
   *  array → the artifact round-trips losslessly. */
  capability?: ApplierCapability;
  /** the integration profile that produced this plan, stamped whenever the plan
   *  was produced through a resolved profile (always, via the CLI). `apply`/
   *  `prove` default to this profile when `--profile` is omitted and reject a
   *  contradicting `--profile`, so the plan == prove == apply invariant is
   *  enforced by the artifact, not just by a comment. Absent only when `plan()`
   *  is called directly with no profile (the raw, no-integration library path —
   *  e.g. the corpus); such a plan is treated as `raw`. */
  profile?: { id: string };
  /** the DIGEST of the baseline subtracted from both sides, stamped whenever the
   *  plan was produced with a baseline (via a resolved profile). `apply`/`prove`
   *  reconcile the baseline they resolve against this digest and fail loud on a
   *  mismatch, so a swapped or edited baseline can't silently diff a different
   *  view. Absent when no baseline was in effect. */
  baseline?: { digest: string };
  /** every rename candidate found, applied or not — "prompt" mode renders
   *  these as questions; near-misses explain why they degraded (§4.1) */
  renameCandidates: RenameCandidate[];
  actions: Action[];
  safetyReport: SafetyReport;
}

export interface PlanOptions {
  /** named serialize parameters consumed by rule templates; unknown
   *  names are a plan-time error (stage 8 wires policies here) */
  params?: PlanParams;
  /** policy (§3.9): filters which deltas this plan manages and supplies
   *  serialize parameters. If the policy DECLARES a baseline, the resolved
   *  baseline FactBase must be passed as `baseline` below — plan() refuses an
   *  unresolved declared baseline rather than silently ignoring it. */
  policy?: Policy;
  /** resolved platform baseline (§3.9): facts present-and-identical here are
   *  subtracted from both sides before diffing, so platform-managed objects are
   *  invisible. Resolve a policy's declared baseline NAME into this FactBase
   *  with `resolveBaseline(policy, { pgMajor })`. plan() stays pure — it
   *  subtracts a provided FactBase, never reads a file. */
  baseline?: FactBase;
  /** rename detection (§4.1, stage 9). "auto" applies unambiguous
   *  candidates; "prompt" reports candidates and applies only those in
   *  acceptRenames; "off" (default) preserves drop+create. */
  renames?: RenameMode;
  /** in "prompt" mode: the candidates the caller confirmed */
  acceptRenames?: Array<{ from: StableId; to: StableId }>;
  /** compaction (§3.6): fold column clauses into their CREATE TABLE when
   *  no graph edge crosses the merge. Cosmetic by contract — proof results
   *  never change (asserted by the compaction suite). Default: true. */
  compact?: boolean;
  /** Export-only constraint folding: also fold VALIDATED table constraints
   *  into their table's CREATE parens (`CONSTRAINT name <def>`), like
   *  hand-written SQL. ONLY safe when the plan's SQL is consumed by the
   *  file loader (bounded retry / reorder) rather than the apply executor —
   *  a folded FK may reference a table a LATER file creates. Set by
   *  `schema export`; leave unset everywhere else. `exclude` lists encoded
   *  constraint ids that must stay as ALTERs (cycle-participating FKs, which
   *  the export routes to `.fk.sql`). */
  foldConstraints?: { exclude?: ReadonlySet<string> };
  /** applier capability (move 6): operations the applier cannot execute (e.g.
   *  FDW ACLs for a non-superuser) are projected out of the view. Supplied by
   *  the resolved profile (`resolveProfile(pool, profile, { restrictToApplier:
   *  true })`), or probe directly with `probeApplierCapability` from
   *  `@supabase/pg-delta/integrations`. Default unrestricted. */
  capability?: ApplierCapability;
  /** the integration profile id to stamp on the plan artifact (set by the
   *  resolved profile's `planOptions`), so `apply`/`prove` can reconstruct the
   *  same managed view without the operator re-specifying `--profile`. */
  profile?: { id: string };
  /** the resolved baseline's DIGEST, stamped onto the plan artifact's
   *  `baseline` field (set by the resolved profile's `planOptions`). Metadata
   *  only — the facts to subtract are `baseline` above; this is what apply/prove
   *  reconcile against. Absent when no baseline is in effect. */
  baselineMeta?: { digest: string };
  /** schemas/roles assumed present-but-unmanaged at apply time, supplementing
   *  any derived from `policy`. The DB-to-DB path supplies a `policy` and the
   *  sets are read from it; callers that already hold a RESOLVED managed view
   *  (e.g. declarative export, which re-plans the view from a pristine baseline)
   *  pass the assumed sets directly so the action-graph requirement guard does
   *  not treat a kept `CREATE EXTENSION … SCHEMA <s>` / `GRANT … TO <role>` as
   *  a stranded reference — without re-running policy filtering/serialize rules
   *  over an already-resolved view. */
  assumedSchemas?: string[];
  assumedRoles?: string[];
  /** the redaction mode used to extract the source/desired fact bases, stamped
   *  onto the artifact so `apply`/`prove` reconstruct the fingerprint identically
   *  (see `Plan.redactSecrets`). Omit on direct library plans. */
  redactSecrets?: boolean;
  /** intent-rule index for stateful-extension intent facts (`extensionIntent`
   *  kind — pg_cron jobs, …). Supplied by the resolved profile
   *  (`resolveProfile` builds it from the profile's handlers' `intentKinds`);
   *  direct library callers with no intent facts omit it. NOT serialized onto
   *  the artifact (it holds functions); `apply`/`prove` reconstruct it from the
   *  same profile. */
  intentRules?: IntentRuleIndex;
}

export function plan(
  rawSource: FactBase,
  rawDesired: FactBase,
  options?: PlanOptions,
): Plan {
  // ── phase 1: change set (managed-view resolution, diff, filter, group,
  // rename + role-rename cancellation) → ./phases/change-set.ts. `source` /
  // `desired` below are the RESOLVED managed views. ────────────────────
  // A desired-side intent object the engine cannot key (an unnamed pg_cron job)
  // can never converge — refuse rather than silently drop it. The handler emits
  // this as a warning during capture; here, on the DESIRED side, it is fatal.
  // (A SOURCE-side unkeyed intent is just unmanaged drift — left untouched.)
  const unkeyed = rawDesired.diagnostics.filter(
    (d) => d.code === INTENT_UNKEYED,
  );
  if (unkeyed.length > 0) {
    throw new Error(
      `plan: the desired state declares intent the engine cannot key — name it so it can be managed:\n` +
        unkeyed.map((d) => `  - ${d.message}`).join("\n"),
    );
  }

  // one id-keyed rule resolver for the whole plan: schema kinds via the static
  // RULES table, `extensionIntent` via the profile-supplied intent rules. Built
  // once and threaded through every phase so all of them dispatch identically.
  const rulesForId = buildRuleResolver(options?.intentRules);

  const {
    source,
    desired,
    projectedDesired,
    deltas,
    filteredDeltas,
    removed,
    added,
    setsByFact,
    renameCandidates,
    acceptedRenames,
    roleRenameMap,
    carriedOwnerLinks,
    changedRoleFacts,
  } = buildChangeSet(rawSource, rawDesired, options, rulesForId);

  // serialize params are emission-time setup, independent of the change set.
  const params: PlanParams = options?.params ?? {};
  for (const name of Object.keys(params)) {
    if (!KNOWN_PARAMS.has(name)) {
      throw new Error(
        `plan: unknown serialize parameter '${name}' — the rule table declares ${[...KNOWN_PARAMS].join(", ")}`,
      );
    }
  }
  // policy serialize rules apply PER FACT (first matching rule's params, §3.9) —
  // explicit options.params override rule-supplied values
  const serializeRules = options?.policy
    ? flattenPolicy(options.policy).serialize
    : [];

  // roles the policy assumes exist at apply time but does not manage (e.g.
  // Supabase's anon/authenticated). Threaded into the action-graph guard so a
  // kept `GRANT … TO <role>` whose role object is filtered out of the view is
  // not mistaken for a stranded requirement (§ managed-view-architecture).
  const assumedRoleNames = new Set([
    ...(options?.policy ? flattenPolicy(options.policy).assumedRoles : []),
    ...(options?.assumedRoles ?? []),
  ]);

  // schemas the policy assumes exist at apply time but does not manage (e.g.
  // Supabase's `extensions`). Threaded into the action-graph guard so a kept
  // `CREATE EXTENSION … SCHEMA <schema>` whose schema object is filtered out of
  // the view is not mistaken for a stranded requirement (§ managed-view-architecture).
  const assumedSchemaNames = new Set([
    ...(options?.policy ? flattenPolicy(options.policy).assumedSchemas : []),
    ...(options?.assumedSchemas ?? []),
  ]);

  // ── phase 2: replacement expansion + drop-root suppression ────────────
  // Classify set-deltas (alter vs replace), expand the forced dependent
  // rebuild, and compute drop-root suppression/redirect (./phases/
  // replacement-expansion.ts). Produces the replaceIds set + dropRootOf map.
  const { replaceIds, dropRootOf } = expandReplacements({
    removed,
    setsByFact,
    source,
    desired,
    rulesForId,
  });

  // ── phase 3: emit actions (./phases/action-emitter.ts) ────────────────
  // Rename actions, creates (parents first), default-privilege hygiene,
  // drops, replaces, in-place alters, role-rename changed-pair mutations, and
  // owner-edge ALTERs — with the emitter's own producer/destroyer/fold
  // bookkeeping. Enforces the create-produces-its-fact invariant.
  const {
    actions,
    producerOf,
    destroyerOf,
    foldHints,
    acceptsFolds,
    renameActionIndices,
  } = emitActions({
    source,
    desired,
    projectedDesired,
    removed,
    added,
    setsByFact,
    replaceIds,
    dropRootOf,
    acceptedRenames,
    roleRenameMap,
    carriedOwnerLinks,
    changedRoleFacts,
    deltas,
    params,
    serializeRules,
    capability: options?.capability,
    rulesForId,
  });

  // ── phase 4: order, segment-mark, compact, and report ─────────────────
  // Graph build + requirement checks, tie-break, segment-boundary marking, and
  // the two cosmetic compaction passes are the ActionGraph phase
  // (./phases/action-graph.ts → ./internal.ts building blocks). Reads only the
  // emitted actions + producer/destroyer indexes + the two RESOLVED fact bases.
  const { actions: finalActions, safetyReport } = finalizeActions({
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
    capability: options?.capability,
    compact: options?.compact !== false,
    foldConstraints: options?.foldConstraints,
    rulesForId,
  });

  return {
    formatVersion: 1,
    engineVersion: ENGINE_VERSION,
    source: { fingerprint: source.rootHash },
    target: { fingerprint: projectedDesired.rootHash },
    preamble: [{ name: "check_function_bodies", value: "off" }],
    deltas,
    filteredDeltas,
    ...(options?.policy ? { policy: options.policy } : {}),
    ...(options?.capability ? { capability: options.capability } : {}),
    ...(options?.profile ? { profile: options.profile } : {}),
    ...(options?.baselineMeta ? { baseline: options.baselineMeta } : {}),
    ...(options?.redactSecrets !== undefined
      ? { redactSecrets: options.redactSecrets }
      : {}),
    renameCandidates,
    actions: finalActions,
    safetyReport,
  };
}
