/**
 * Planner phase 1 — ChangeSet (target-architecture §3.4, §3.9, §4.1).
 *
 * Resolves the managed VIEW on both sides, performs a policy-filtered discovery
 * diff to accept renames, normalizes accepted role identities into desired-name
 * space, then diffs and filters the canonical pair for the actual plan. Pure
 * over its inputs; the resolved views + worklists + rename bookkeeping it
 * returns are the single input to the rest of the planner.
 */
import { diff, type Delta } from "../../core/diff.ts";
import type { Fact, FactBase } from "../../core/fact.ts";
import { encodeId, type StableId } from "../../core/stable-id.ts";
import { filterDeltas, validatePolicy } from "../../policy/policy.ts";
import { reconstructManagedView } from "../../policy/reconstruct.ts";
import {
  buildRoleRenameMap,
  normalizeRoleIdentities,
  relabelRoleNames,
} from "../identity-normalize.ts";
import type { PlanOptions } from "../plan.ts";
import { projectTarget } from "../project.ts";
import {
  matchRenameCandidates,
  subtreeIds,
  type RenameCandidate,
  type RenameMode,
} from "../renames.ts";
import type { RulesForId } from "../rules.ts";

/** Accepted rename facts stay physical so rename SQL renders old -> new. The
 * subtree identities are captured before role normalization for honest action
 * metadata even though every downstream fact base is canonical. */
export interface AcceptedRename {
  from: Fact;
  to: Fact;
  sourceSubtree: StableId[];
  desiredSubtree: StableId[];
}

export interface ChangeSet {
  /** resolved physical source — used only by the apply fingerprint gate */
  physicalSource: FactBase;
  /** canonical managed-view source / desired — what everything downstream uses */
  source: FactBase;
  desired: FactBase;
  /** desired with every FILTERED delta reverted to source — the honest plan
   * target (fingerprint + proof target) */
  projectedDesired: FactBase;
  deltas: Delta[];
  filteredDeltas: Delta[];
  /** add/remove worklists (ordinary rename cancellation already applied) and
   * set-deltas grouped by encoded fact id */
  removed: Map<string, Fact>;
  added: Map<string, Fact>;
  setsByFact: Map<string, Extract<Delta, { verb: "set" }>[]>;
  renameCandidates: RenameCandidate[];
  acceptedRenames: AcceptedRename[];
}

function groupDeltas(deltas: readonly Delta[]): {
  removed: Map<string, Fact>;
  added: Map<string, Fact>;
  setsByFact: Map<string, Extract<Delta, { verb: "set" }>[]>;
} {
  const removed = new Map<string, Fact>();
  const added = new Map<string, Fact>();
  const setsByFact = new Map<string, Extract<Delta, { verb: "set" }>[]>();
  for (const delta of deltas) {
    if (delta.verb === "remove") {
      removed.set(encodeId(delta.fact.id), delta.fact);
    } else if (delta.verb === "add") {
      added.set(encodeId(delta.fact.id), delta.fact);
    } else if (delta.verb === "set") {
      const key = encodeId(delta.id);
      const list = setsByFact.get(key) ?? [];
      list.push(delta);
      setsByFact.set(key, list);
    }
  }
  return { removed, added, setsByFact };
}

/** Whether the effective policy-projected target is exactly compatible with a
 * physical ordinary rename. The old root must be gone, the complete desired
 * subtree (including outgoing edges via its Merkle rollup) must be unchanged,
 * and incoming edges to every renamed descendant must match. Comparing the
 * projected target—not raw filtered deltas—allows harmless old-side facts that
 * projectTarget pruned as orphans while still rejecting partial new subtrees. */
function renameMatchesProjectedTarget(
  desired: FactBase,
  projectedDesired: FactBase,
  from: StableId,
  to: StableId,
): boolean {
  if (projectedDesired.has(from) || !projectedDesired.has(to)) return false;
  if (projectedDesired.rollupOf(to) !== desired.rollupOf(to)) return false;

  const desiredSubtree = new Set(subtreeIds(desired, to).map(encodeId));
  const incomingSignature = (fb: FactBase): string[] =>
    fb.edges
      .filter((edge) => desiredSubtree.has(encodeId(edge.to)))
      .map(
        (edge) => `${encodeId(edge.from)}-[${edge.kind}]->${encodeId(edge.to)}`,
      )
      .sort();
  const desiredIncoming = incomingSignature(desired);
  const projectedIncoming = incomingSignature(projectedDesired);
  return (
    desiredIncoming.length === projectedIncoming.length &&
    desiredIncoming.every((edge, index) => edge === projectedIncoming[index])
  );
}

/** Build the canonical change set while retaining the physical source gate. */
export function buildChangeSet(
  rawSource: FactBase,
  rawDesired: FactBase,
  options: PlanOptions | undefined,
  rulesForId: RulesForId,
): ChangeSet {
  if (options?.policy) validatePolicy(options.policy);
  // A declared baseline must never be silently ignored: the caller must resolve
  // it and pass the resulting FactBase into every planning entry point.
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

  // `reconstructManagedView` seals baseline subtraction, policy projection,
  // extension-member handling, and management scope in one shared composition.
  const physicalSource = reconstructManagedView(rawSource, {
    policy: options?.policy,
    capability: options?.capability,
    baseline: options?.baseline,
    scope: options?.scope,
    defaultOwner: options?.defaultOwner,
  });
  const physicalDesired = reconstructManagedView(rawDesired, {
    policy: options?.policy,
    capability: options?.capability,
    baseline: options?.baseline,
    scope: options?.scope,
    defaultOwner: options?.defaultOwner,
  });

  // Rename proposals come from policy-kept deltas in physical identity space.
  // This is intentionally a discovery pass: the actual plan is built from a
  // second diff after accepted role identities have been canonicalized.
  const discoveryAllDeltas = diff(physicalSource, physicalDesired);
  const { kept: discoveryDeltas } = options?.policy
    ? filterDeltas(
        discoveryAllDeltas,
        options.policy,
        physicalSource,
        physicalDesired,
      )
    : { kept: discoveryAllDeltas };
  const { removed: discoveryRemoved, added: discoveryAdded } =
    groupDeltas(discoveryDeltas);

  const renameMode: RenameMode = options?.renames ?? "off";
  const renameCandidates: RenameCandidate[] = [];
  const discoveredRenames: AcceptedRename[] = [];
  if (renameMode !== "off") {
    const candidates = matchRenameCandidates(
      discoveryRemoved,
      discoveryAdded,
      physicalSource,
      physicalDesired,
      rulesForId,
    );
    renameCandidates.push(...candidates);
    const confirmed = new Set(
      (options?.acceptRenames ?? []).map(
        (rename) => `${encodeId(rename.from)}>${encodeId(rename.to)}`,
      ),
    );
    for (const candidate of candidates) {
      if (candidate.status !== "unambiguous") continue;
      const key = `${encodeId(candidate.from)}>${encodeId(candidate.to)}`;
      if (renameMode === "prompt" && !confirmed.has(key)) continue;
      const from = discoveryRemoved.get(encodeId(candidate.from)) as Fact;
      const to = discoveryAdded.get(encodeId(candidate.to)) as Fact;
      discoveredRenames.push({
        from,
        to,
        sourceSubtree: subtreeIds(physicalSource, candidate.from),
        desiredSubtree: subtreeIds(physicalDesired, candidate.to),
      });
    }
  }

  // PostgreSQL carries role references by OID. Rewrite both managed views into
  // desired-name space so the generic diff sees that continuity directly.
  const roleRenameMap = buildRoleRenameMap(discoveredRenames);
  const source = normalizeRoleIdentities(physicalSource, roleRenameMap);
  const desired = normalizeRoleIdentities(physicalDesired, roleRenameMap);

  const allDeltas = diff(source, desired);
  const { kept: deltas, filtered: filteredDeltas } = options?.policy
    ? filterDeltas(allDeltas, options.policy, source, desired)
    : { kept: allDeltas, filtered: [] };
  // The honest target is canonical desired with every filtered delta reverted
  // to canonical source. The physical source is retained only for fingerprinting.
  const projectedDesired = projectTarget(desired, filteredDeltas);
  const { removed, added, setsByFact } = groupDeltas(deltas);

  // Discovery runs in physical identity space, but canonical filtering can
  // change the effective target of an ordinary object rename. PostgreSQL cannot
  // rename only part of a subtree, so retain the rename only when the projected
  // target contains no old root and exactly the desired destination subtree and
  // incoming edges. Leave surviving worklist entries alone otherwise so
  // ordinary create/drop converges on the policy-projected target.
  // Accepted role renames are the deliberate exception: normalization erases
  // their canonical remove/add pair by construction, while PostgreSQL carries
  // their normalized role references by OID.
  const acceptedRenames = discoveredRenames.filter(({ from, to }) => {
    if (from.id.kind === "role" && to.id.kind === "role") return true;
    const canonicalFrom = relabelRoleNames(from.id, roleRenameMap);
    const canonicalTo = relabelRoleNames(to.id, roleRenameMap);
    return (
      removed.has(encodeId(canonicalFrom)) &&
      added.has(encodeId(canonicalTo)) &&
      renameMatchesProjectedTarget(
        desired,
        projectedDesired,
        canonicalFrom,
        canonicalTo,
      )
    );
  });

  // Ordinary object renames still remove their structural subtrees from the
  // create/drop worklists. Role renames are already one canonical identity;
  // any simultaneous payload change remains an ordinary set delta.
  for (const { from, to } of acceptedRenames) {
    if (from.id.kind === "role" && to.id.kind === "role") continue;
    const canonicalFrom = relabelRoleNames(from.id, roleRenameMap);
    const canonicalTo = relabelRoleNames(to.id, roleRenameMap);
    for (const id of subtreeIds(source, canonicalFrom)) {
      removed.delete(encodeId(id));
    }
    for (const id of subtreeIds(desired, canonicalTo)) {
      added.delete(encodeId(id));
    }
  }

  return {
    physicalSource,
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
  };
}
