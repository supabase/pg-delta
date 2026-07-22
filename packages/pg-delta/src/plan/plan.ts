/**
 * The planner (target-architecture §3.4–3.6): deltas × rule table → atomic
 * actions → one mixed dependency graph → one deterministic sort.
 */
import { INTENT_UNKEYED, USER_MAPPING_UNREADABLE } from "../core/diagnostic.ts";
import { subjectOf, type Delta } from "../core/diff.ts";
import type { FactBase } from "../core/fact.ts";
import { encodeId, type StableId } from "../core/stable-id.ts";
import { flattenPolicy, type Policy } from "../policy/policy.ts";
import type { ApplierCapability } from "../policy/capability.ts";
import {
  auditManagedViewProjection,
  type ProjectionAudit,
} from "../policy/reconstruct.ts";
import type { ManagementScope } from "../policy/view.ts";
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
export const ENGINE_VERSION = "0.2.0";

// The plan-artifact (JSON serialize/parse) helpers live in ./artifact.ts but are
// part of this module's public surface: docs/getting-started.md imports them from
// `@supabase/pg-delta/plan` (the subpath that maps here), so the documented path
// must be real. Cycle-safe: artifact.ts's only import from this module is
// ENGINE_VERSION, which it reads inside a function body, never at module-eval time.
export { parsePlan, serializePlan } from "./artifact.ts";
export type {
  ProjectionAudit,
  ProjectionAuditEntry,
  ProjectionAuditSuppression,
} from "../policy/reconstruct.ts";
export type {
  ProjectionAuditClassification,
  ProjectionAuditStage,
  ProjectionAuditSubject,
} from "../policy/view.ts";

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
  /** Raw source↔desired differences suppressed by managed-view projection,
   * attributed to stable stage/rule reason codes. Generated plans always carry
   * this field; optional only so pre-P2a v1 artifacts remain parseable. */
  projectionAudit?: ProjectionAudit;
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
  /** the management scope the plan's managed view was projected to (§scope),
   *  stamped whenever it is not the default cluster scope. `apply`/`prove`
   *  reconstruct the fingerprint/proof view with `projectManagementScope(...,
   *  scope)` applied AFTER `resolveView`, so plan == prove == run holds under a
   *  database-scoped profile. Absent (⇒ "cluster") on direct library plans. */
  scope?: ManagementScope;
  /** the resolved DEFAULT OWNER the database-scope projection kept implicit (its
   *  `owner` edges pruned → no `ALTER … OWNER TO`), stamped so `apply`/`prove`
   *  reconstruct the identical managed-view-under-scope. Absent ⇒ verbose (every
   *  retained owner edge serializes) and on cluster/direct-library plans. */
  defaultOwner?: string;
  /** every rename candidate found, applied or not — "prompt" mode renders
   *  these as questions; near-misses explain why they degraded (§4.1) */
  renameCandidates: RenameCandidate[];
  /** the renames this plan actually applied (as { from, to } stable-id pairs),
   *  stamped only when non-empty so corpus / direct-library plan artifacts stay
   *  byte-identical. The proof loop reads this to keep a renamed table under
   *  data-preservation coverage: an accepted rename destroys the OLD subtree, so
   *  without this stamp the old relKey looks "recreated" and the renamed table
   *  is silently skipped (F7). */
  acceptedRenames?: Array<{ from: StableId; to: StableId }>;
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
  /** management scope of the managed view (§scope): "database" (the declarative
   *  default) removes cluster-global role/membership facts and their owner edges
   *  from BOTH diff sides AFTER `resolveView`, so a policy owner-exclusion rule
   *  still sees the owner edges it matches on. "cluster" (the default here when
   *  omitted) is the identity projection — direct library callers / the corpus
   *  are unaffected. Set by the CLI's `schema apply`. */
  scope?: ManagementScope;
  /** the DEFAULT OWNER for the database-scope projection: `owner` edges to this
   *  role are pruned (kept implicit → no `ALTER … OWNER TO`); every other
   *  surviving object's owner edge is retained as an assumed reference and
   *  serializes. Undefined ⇒ verbose (keep every retained owner edge). Ignored
   *  at cluster scope (roles are managed). Stamped onto the artifact so
   *  `apply`/`prove` reconstruct the identical view. Set by `schema export` /
   *  `schema apply` from the resolved default-owner chain. */
  defaultOwner?: string;
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

  const projectionAudit = auditManagedViewProjection(rawSource, rawDesired, {
    ...(options?.policy !== undefined ? { policy: options.policy } : {}),
    ...(options?.capability !== undefined
      ? { capability: options.capability }
      : {}),
    ...(options?.baseline !== undefined ? { baseline: options.baseline } : {}),
    ...(options?.scope !== undefined ? { scope: options.scope } : {}),
    ...(options?.defaultOwner !== undefined
      ? { defaultOwner: options.defaultOwner }
      : {}),
  });

  // A user-mapping row whose options were unreadable via pg_user_mappings on
  // either side (extraction-time warning, USER_MAPPING_UNREADABLE — see
  // src/extract/foreign.ts) has an UNKNOWN true state on that side. A warning
  // alone doesn't protect anything here: if only one side's extraction could
  // see the mapping, the other side's missing fact reads as an intentional
  // add/remove and would otherwise plan a wrong CREATE/DROP USER MAPPING
  // (Codex P1 on PR #338). Escalate to fatal exactly when a delta that would
  // actually produce an action touches one of these subjects — checked
  // against `deltas` (the KEPT, post-policy-filter list that actually drives
  // actions; `filteredDeltas` is the policy-EXCLUDED complement — see
  // buildChangeSet's `{ kept: deltas, filtered: filteredDeltas }`), so a
  // policy that excludes user mappings entirely keeps planning legal. Hidden
  // on BOTH sides means no delta ever touches the subject (nothing to diff),
  // so planning proceeds.
  //
  // The same blind spot applies one level up (Codex P2s, PR #338): a DROP of
  // the mapping's containing server, or of its (non-PUBLIC) mapped role,
  // implicitly destroys the hidden mapping too — CASCADE-style — without any
  // delta ever naming the mapping directly. So a `remove` delta on either is
  // ALSO gated. Remove-verb ONLY: ALTERs / owner changes on the server or
  // role don't destroy the mapping, so gating them would be pure
  // over-blocking with no correctness benefit (zero-over-block property). A
  // source-side unreadable diagnostic already PROVES the mapping exists, so a
  // source-side DROP SERVER/ROLE is guaranteed to fail at apply regardless
  // (FK-style: Postgres won't let you drop a server/role a mapping still
  // references) — refusing in plan() just surfaces that earlier and louder.
  //
  // KNOWN LIMITATION (deliberately not handled here, tracked as a follow-up):
  // a role RENAME combined with a one-side-hidden mapping. Rename-carry logic
  // cancels the resulting remove/add pair into a single rename action before
  // this gate runs on raw deltas from the ORIGINAL role name, so a renamed
  // role is invisible to the `unreadableRoles` name-set built below in that
  // case. In the realistic direction (the mapping is hidden on the SOURCE
  // side), this still fails safely — apply cannot rename a role a hidden
  // mapping references, for the same FK-style reason as a DROP. The only
  // truly gap is a hidden mapping combined with a rename that requires an
  // atypical desired-side privilege inversion, which is not addressed by a
  // rename-aware translation here.
  //
  // KNOWN LIMITATION #2 (Codex P1, PR #338 comment 3603601149 — documented,
  // NOT gated): a DESIRED-side unreadable mapping whose containing server (or
  // FDW/role) doesn't exist on the SOURCE side at all. The resulting `add`
  // deltas for the container (CREATE FDW / CREATE SERVER / CREATE ROLE) are
  // NOT gated, so plan() proceeds and simply omits the un-creatable CREATE
  // USER MAPPING (the mapping fact itself was never added to the desired
  // FactBase — it was skipped as unreadable). This is deliberate: the gate
  // family above protects PHYSICAL safety (destroying/failing-to-apply
  // something that already exists); this case is a DESIRED-STATE FIDELITY
  // problem instead — the delta belongs to the server/role, but the
  // manageability question belongs to the mapping, so blocking the
  // container's `add` here would be a policy-projection layering violation,
  // not a safety fix. It's silent-but-visible: the extraction-time
  // USER_MAPPING_UNREADABLE diagnostic already prints (and is a candidate for
  // the #340 reporting channel to surface more prominently); nothing here
  // fabricates or corrupts state. The SOURCE-side analogue is vacuous — a
  // source-side unreadable diagnostic, by construction, means the container
  // exists on source (extraction reached it to emit the diagnostic), so an
  // `add` for it can never occur from that side.
  const unreadableMappingSubjects = new Set<string>();
  const unreadableServers = new Set<string>();
  const unreadableRoles = new Set<string>();
  for (const d of [...rawSource.diagnostics, ...rawDesired.diagnostics]) {
    if (d.code !== USER_MAPPING_UNREADABLE || d.subject === undefined) {
      continue;
    }
    const subject = d.subject as {
      kind: "userMapping";
      server: string;
      role: string;
    };
    unreadableMappingSubjects.add(encodeId(subject));
    unreadableServers.add(subject.server);
    if (subject.role !== "PUBLIC") unreadableRoles.add(subject.role);
  }
  if (unreadableMappingSubjects.size > 0) {
    const touched = new Map<string, { id: StableId; relation: string }>();
    for (const delta of deltas) {
      const id = subjectOf(delta);
      const key = encodeId(id);
      if (unreadableMappingSubjects.has(key)) {
        touched.set(key, { id, relation: "mapping" });
        continue;
      }
      if (delta.verb === "remove") {
        if (id.kind === "server" && unreadableServers.has(id.name)) {
          touched.set(key, {
            id,
            relation: "server of an unreadable mapping",
          });
        } else if (id.kind === "role" && unreadableRoles.has(id.name)) {
          touched.set(key, { id, relation: "role of an unreadable mapping" });
        }
        continue;
      }
      // A "replace"-class attribute (server.type / server.fdw — see
      // rules/foreign.ts) never in-place ALTERs: expandReplacements (below,
      // after this gate) turns a `set` delta on one into DROP + CREATE,
      // which destroys the hidden mapping exactly like an explicit DROP
      // SERVER would (Codex P2, PR #338 comment 3602512706). Gate it the
      // same way, using the SAME rule table the expander itself consults
      // (`rulesForId`, built above) so the two can never drift. Non-replace
      // attributes (version, options, owner) genuinely in-place ALTER and
      // leave the mapping alone — must stay ungated (zero-over-block).
      if (
        delta.verb === "set" &&
        id.kind === "server" &&
        unreadableServers.has(id.name) &&
        rulesForId(id).attributes[delta.attr] === "replace"
      ) {
        touched.set(key, {
          id,
          relation: "server of an unreadable mapping (replaced)",
        });
      }
    }
    if (touched.size > 0) {
      const lines = [...touched.values()]
        .map(({ id, relation }) => {
          if (id.kind === "userMapping") {
            const m = id as { server: string; role: string };
            return `${m.server}/${m.role} (mapping)`;
          }
          const named = id as { name: string };
          return `${named.name} (${relation})`;
        })
        .sort();
      throw new Error(
        `plan: the state of these user mappings is unknown on one side (options unreadable via pg_user_mappings) — refusing to plan changes touching them, their containing server, or their mapped role; extract with a role that can read pg_user_mapping:\n` +
          lines.map((n) => `  - ${n}`).join("\n"),
      );
    }
  }

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

  // Database-scope projection RETAINS `owner` edges to scope-projected roles as
  // dangling assumed references (view.ts), so a kept `ALTER … OWNER TO <role>`
  // would otherwise strand the action-graph requirement guard (the role object
  // was projected out but exists at apply time). Auto-add every such target role
  // name (from BOTH resolved sides) to the assumed set — the exact analogue of a
  // GRANT to an assumed role — so apply works without the caller re-threading it.
  for (const fb of [source, desired]) {
    for (const e of fb.edges) {
      if (e.kind === "owner" && e.to.kind === "role" && !fb.has(e.to)) {
        assumedRoleNames.add((e.to as { kind: "role"; name: string }).name);
      }
    }
  }

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
    preamble: [
      // Pin the applier's deparse/resolution path to `pg_catalog` so the
      // rendered (fully qualified) DDL resolves identically regardless of the
      // applier role's default search_path. Extraction canonicalizes to the
      // same path, so every emitted statement target is already qualified.
      { name: "search_path", value: "pg_catalog" },
      { name: "check_function_bodies", value: "off" },
    ],
    deltas,
    filteredDeltas,
    projectionAudit,
    ...(options?.policy ? { policy: options.policy } : {}),
    ...(options?.capability ? { capability: options.capability } : {}),
    ...(options?.profile ? { profile: options.profile } : {}),
    ...(options?.baselineMeta ? { baseline: options.baselineMeta } : {}),
    // stamp scope only when it is not the default cluster projection, so corpus
    // / direct-library plan artifacts stay byte-identical.
    ...(options?.scope !== undefined && options.scope !== "cluster"
      ? { scope: options.scope }
      : {}),
    // stamp the resolved default owner so apply/prove reconstruct the identical
    // database-scope view. Only meaningful (and only stamped) at database scope.
    ...(options?.defaultOwner !== undefined &&
    options?.scope !== undefined &&
    options.scope !== "cluster"
      ? { defaultOwner: options.defaultOwner }
      : {}),
    ...(options?.redactSecrets !== undefined
      ? { redactSecrets: options.redactSecrets }
      : {}),
    renameCandidates,
    // stamp accepted renames only when there are any, so corpus / direct-library
    // plan artifacts stay byte-identical (F7).
    ...(acceptedRenames.length > 0
      ? {
          acceptedRenames: acceptedRenames.map((r) => ({
            from: r.from.id,
            to: r.to.id,
          })),
        }
      : {}),
    actions: finalActions,
    safetyReport,
  };
}
