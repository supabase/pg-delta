/**
 * Planner phase 1 — ChangeSet (target-architecture §3.4, §3.9, §4.1).
 *
 * Resolves the managed VIEW (baseline subtraction + policy/extension-member
 * projection) on both sides, diffs, applies the policy delta filter, and groups
 * the kept deltas into added/removed/set worklists. Then it cancels what an
 * accepted rename or a role rename carries — so replacement expansion and action
 * emission never see a delta the rename already accounts for. Pure over its
 * inputs; the resolved views + worklists + rename bookkeeping it returns are the
 * single input to the rest of the planner.
 */
import { diff, type Delta } from "../../core/diff.ts";
import type { Fact, FactBase } from "../../core/fact.ts";
import type { Payload } from "../../core/hash.ts";
import { encodeId, type StableId } from "../../core/stable-id.ts";
import {
  filterDeltas,
  resolveView,
  validatePolicy,
} from "../../policy/policy.ts";
import { projectManagementScope } from "../../policy/view.ts";
import type { PlanOptions } from "../plan.ts";
import type { RulesForId } from "../rules.ts";
import { projectTarget } from "../project.ts";
import {
  matchRenameCandidates,
  subtreeIds,
  type RenameCandidate,
  type RenameMode,
} from "../renames.ts";
import {
  buildRoleRenameMap,
  computeRoleRenameCarry,
  roleNamesIn,
} from "../role-rename-carry.ts";

/** A role-name-bearing fact whose identity a role rename carries but whose
 *  payload also changed: emit the payload change against the post-rename id,
 *  ordered after the rename (orderingConsumes). */
export interface ChangedRoleFact {
  toFact: Fact;
  fromPayload: Payload;
  orderingConsumes: StableId[];
}

export interface ChangeSet {
  /** resolved (managed-view) source / desired — what everything downstream uses */
  source: FactBase;
  desired: FactBase;
  /** desired with every FILTERED delta reverted to source — the honest plan
   *  target (fingerprint + proof target) */
  projectedDesired: FactBase;
  deltas: Delta[];
  filteredDeltas: Delta[];
  /** add/remove worklists (rename + role-rename cancellation already applied)
   *  and set-deltas grouped by encoded fact id */
  removed: Map<string, Fact>;
  added: Map<string, Fact>;
  setsByFact: Map<string, Extract<Delta, { verb: "set" }>[]>;
  renameCandidates: RenameCandidate[];
  acceptedRenames: Array<{ from: Fact; to: Fact }>;
  /** source-role-name → dest-role-name, from accepted role renames */
  roleRenameMap: Map<string, string>;
  /** owner LINK edge keys a role rename carries (skip in the owner loop) */
  carriedOwnerLinks: Set<string>;
  changedRoleFacts: ChangedRoleFact[];
}

/**
 * Build the change set: resolve views, diff, filter, group, and apply rename /
 * role-rename cancellation. Behavior-preserving extraction of `plan()`'s head.
 */
export function buildChangeSet(
  rawSource: FactBase,
  rawDesired: FactBase,
  options: PlanOptions | undefined,
  rulesForId: RulesForId,
): ChangeSet {
  if (options?.policy) validatePolicy(options.policy);
  // a declared baseline must NEVER be silently ignored (review finding 3): if
  // the policy names a baseline, the caller must resolve it (resolveBaseline)
  // and pass it as options.baseline. Refuse otherwise — at every entry point.
  if (
    options?.policy?.baseline !== undefined &&
    options.baseline === undefined
  ) {
    throw new Error(
      `plan: policy "${options.policy.id}" declares baseline "${options.policy.baseline}" ` +
        `but no resolved baseline was provided. Resolve it with ` +
        `resolveBaseline(policy, { pgMajor }) and pass it as options.baseline, so ` +
        `platform facts are actually subtracted — a declared baseline is never silently ignored.`,
    );
  }
  // the managed VIEW the engine diffs (docs/architecture/managed-view-architecture.md):
  // the platform baseline is subtracted, then the policy's scope (non-`verb`)
  // rules are projected out and extension members are marked reference-only, at
  // the FACT level on BOTH sides, so the proof stays honest by construction.
  // `verb` rules remain for the delta-level filter below. With no policy/baseline
  // and no member edges this is the identity projection, so the corpus is unchanged.
  //
  // The management-scope projection runs AFTER resolveView, never before: a
  // policy owner-exclusion rule (Supabase Rule 6) reads the `owner` edge, and
  // `projectManagementScope("database")` prunes role facts together with those
  // owner edges — so projecting scope first would strip the edge the policy
  // needs and wrongly plan a DROP of a platform object owned by a system role
  // (e.g. an event trigger). This is the SAME order `schema export` uses, and it
  // is done HERE (the single managed-view-under-scope definition) so plan, the
  // apply fingerprint gate, and the proof loop all reconstruct the identical
  // view — `plan == prove == run`. `scope` defaults to "cluster", which is the
  // identity projection, so direct library callers / the corpus are unchanged.
  const scope = options?.scope ?? "cluster";
  const source = projectManagementScope(
    resolveView(
      rawSource,
      options?.policy,
      options?.capability,
      options?.baseline,
    ),
    scope,
  );
  const desired = projectManagementScope(
    resolveView(
      rawDesired,
      options?.policy,
      options?.capability,
      options?.baseline,
    ),
    scope,
  );

  const allDeltas = diff(source, desired);
  const { kept: deltas, filtered: filteredDeltas } = options?.policy
    ? filterDeltas(allDeltas, options.policy, source, desired)
    : { kept: allDeltas, filtered: [] };
  // the honest plan target: `desired` with every FILTERED delta reverted to its
  // source value, since the plan only applies KEPT deltas (review #2). The
  // fingerprint and the proof both target THIS, not full `desired`.
  const projectedDesired = projectTarget(desired, filteredDeltas);

  const removed = new Map<string, Fact>();
  const added = new Map<string, Fact>();
  const setsByFact = new Map<string, Extract<Delta, { verb: "set" }>[]>();
  for (const delta of deltas) {
    if (delta.verb === "remove")
      removed.set(encodeId(delta.fact.id), delta.fact);
    if (delta.verb === "add") added.set(encodeId(delta.fact.id), delta.fact);
    if (delta.verb === "set") {
      const key = encodeId(delta.id);
      const list = setsByFact.get(key) ?? [];
      list.push(delta);
      setsByFact.set(key, list);
    }
  }

  // ── rename detection (§4.1, stage 9) ──────────────────────────────────
  // accepted renames cancel their remove/add subtrees BEFORE replace, rebuild,
  // and suppression see them; the rename action is emitted later.
  const renameMode: RenameMode = options?.renames ?? "off";
  const renameCandidates: RenameCandidate[] = [];
  const acceptedRenames: Array<{ from: Fact; to: Fact }> = [];
  if (renameMode !== "off") {
    const candidates = matchRenameCandidates(
      removed,
      added,
      source,
      desired,
      rulesForId,
    );
    renameCandidates.push(...candidates);
    const confirmed = new Set(
      (options?.acceptRenames ?? []).map(
        (r) => `${encodeId(r.from)}>${encodeId(r.to)}`,
      ),
    );
    for (const candidate of candidates) {
      if (candidate.status !== "unambiguous") continue;
      const key = `${encodeId(candidate.from)}>${encodeId(candidate.to)}`;
      if (renameMode === "prompt" && !confirmed.has(key)) continue;
      const fromFact = removed.get(encodeId(candidate.from)) as Fact;
      const toFact = added.get(encodeId(candidate.to)) as Fact;
      // structural equality covers the whole subtree: cancel every descendant's
      // remove/add — the rename carries them implicitly
      for (const id of subtreeIds(source, candidate.from))
        removed.delete(encodeId(id));
      for (const id of subtreeIds(desired, candidate.to))
        added.delete(encodeId(id));
      acceptedRenames.push({ from: fromFact, to: toFact });
    }
  }

  // ── role-rename carry (role-rename-carry.ts) ──────────────────────────
  // PostgreSQL carries every role-name-bearing fact through `ALTER ROLE …
  // RENAME` by OID. The diff still surfaces those as remove/add (or owner
  // unlink/link) pairs differing only by the renamed name; this Module decides,
  // in ONE place, which the rename carries so emission re-issues no DDL for
  // them. carriedFactKeys (acl/membership/userMapping/defaultPrivilege) are
  // cancelled from the worklists here; carriedOwnerLinks are skipped in the
  // owner-edge loop later (where the role-only-rename owner cycle lived).
  const roleRenameMap = buildRoleRenameMap(acceptedRenames);
  const { carriedFactKeys, carriedOwnerLinks, changedFacts } =
    computeRoleRenameCarry(deltas, roleRenameMap);
  for (const key of carriedFactKeys) {
    removed.delete(key);
    added.delete(key);
  }
  // A changed pair carries the IDENTITY (old name → new name by OID) but the
  // payload also changed. Cancel the old-name teardown AND the new-name create,
  // and capture the facts so emission can mutate the post-rename id instead
  // (review P2, fourth follow-up). The renamed roles the new id references order
  // that mutation AFTER the role rename.
  const targetRoleNames = new Set(roleRenameMap.values());
  const changedRoleFacts: ChangedRoleFact[] = [];
  for (const { from, to } of changedFacts) {
    const fromFact = removed.get(encodeId(from));
    const toFact = added.get(encodeId(to));
    removed.delete(encodeId(from));
    added.delete(encodeId(to));
    if (fromFact === undefined || toFact === undefined) continue;
    changedRoleFacts.push({
      toFact,
      fromPayload: fromFact.payload,
      orderingConsumes: [...roleNamesIn(to)]
        .filter((name) => targetRoleNames.has(name))
        .map((name) => ({ kind: "role", name }) as StableId),
    });
  }

  return {
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
  };
}
