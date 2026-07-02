/**
 * Planner phase 3 — ActionEmitter (target-architecture §3.4–3.5).
 *
 * Turns the projected change set + replacement expansion into the atomic action
 * list, with its OWN producer/destroyer/fold bookkeeping (local to this phase —
 * the cohesive emission algorithm the planner once inlined). Emits, in order:
 * rename actions, creates (parents first), default-privilege hygiene, drops,
 * replaces (drop + recreate), in-place alters, role-rename changed-pair
 * mutations, and owner-edge ALTERs. Enforces the create-produces-its-fact
 * invariant at the phase boundary (review architecture rec #2).
 */
import type { Delta } from "../../core/diff.ts";
import type { Fact, FactBase } from "../../core/fact.ts";
import { canonicalize } from "../../core/hash.ts";
import { encodeId, type StableId } from "../../core/stable-id.ts";
import {
  canSetOwner,
  type ApplierCapability,
} from "../../policy/capability.ts";
import { factMatches, type SerializeRule } from "../../policy/policy.ts";
import { lockClassFor } from "../locks.ts";
import type { Action } from "../plan.ts";
import { grantTarget, qid } from "../render.ts";
import { subtreeIds } from "../renames.ts";
import { ruleFlag } from "../rule-flags.ts";
import { ownerEdgeKey } from "../role-rename-carry.ts";
import { type ActionSpec, type PlanParams, rulesFor } from "../rules.ts";
import type { ChangedRoleFact } from "./change-set.ts";

export interface ActionEmitterInput {
  /** resolved source / desired views + the projected plan target */
  source: FactBase;
  desired: FactBase;
  projectedDesired: FactBase;
  /** add/remove worklists + grouped set-deltas (rename cancellation applied) */
  removed: ReadonlyMap<string, Fact>;
  added: ReadonlyMap<string, Fact>;
  setsByFact: ReadonlyMap<string, Extract<Delta, { verb: "set" }>[]>;
  /** from ReplacementExpansion */
  replaceIds: ReadonlySet<string>;
  dropRootOf: ReadonlyMap<string, string>;
  /** from ChangeSet */
  acceptedRenames: ReadonlyArray<{ from: Fact; to: Fact }>;
  roleRenameMap: ReadonlyMap<string, string>;
  carriedOwnerLinks: ReadonlySet<string>;
  changedRoleFacts: readonly ChangedRoleFact[];
  deltas: readonly Delta[];
  /** serialize params + policy serialize rules */
  params: PlanParams;
  serializeRules: readonly SerializeRule[];
  capability: ApplierCapability | undefined;
}

export interface ActionEmitterOutput {
  actions: Action[];
  producerOf: Map<string, number>;
  destroyerOf: Map<string, number>;
  foldHints: Array<{ foldInto: StableId; clause: string } | undefined>;
  acceptsFolds: boolean[];
  renameActionIndices: Set<number>;
}

/**
 * Emit the atomic action list from the change set + replacement expansion.
 * Behavior-preserving extraction of `plan()`'s emission block.
 */
export function emitActions(input: ActionEmitterInput): ActionEmitterOutput {
  const {
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
    capability,
  } = input;

  const actions: Action[] = [];
  const producerOf = new Map<string, number>();
  const destroyerOf = new Map<string, number>();
  // transient per-action compaction metadata (never enters the artifact)
  const foldHints: Array<{ foldInto: StableId; clause: string } | undefined> =
    [];
  const acceptsFolds: boolean[] = [];

  const pushAction = (
    verb: Action["verb"],
    spec: ActionSpec,
    opts: {
      produces?: StableId[];
      consumes?: StableId[];
      destroys?: StableId[];
    },
  ): number => {
    const index = actions.length;
    const produces = [...(opts.produces ?? []), ...(spec.alsoProduces ?? [])];
    const destroys = [...(opts.destroys ?? []), ...(spec.alsoDestroys ?? [])];
    const consumes = [...(opts.consumes ?? []), ...(spec.consumes ?? [])];
    const subjectKind = (produces[0] ?? destroys[0] ?? consumes[0])?.kind;
    actions.push({
      sql: spec.sql,
      verb,
      produces,
      consumes,
      destroys,
      releases: spec.releases ?? [],
      transactionality: spec.transactionality ?? "transactional",
      lockClass:
        spec.lockClass ??
        (subjectKind === undefined ? "none" : lockClassFor(subjectKind, verb)),
      newSegmentBefore: false,
      dataLoss: spec.dataLoss ?? "none",
      rewriteRisk: spec.rewriteRisk ?? false,
    });
    foldHints[index] = spec.compaction;
    acceptsFolds[index] = spec.acceptsColumnFolds ?? false;
    for (const id of produces) {
      const key = encodeId(id);
      if (!producerOf.has(key)) producerOf.set(key, index);
    }
    for (const id of destroys) destroyerOf.set(encodeId(id), index);
    return index;
  };

  const paramsCache = new Map<string, PlanParams>();
  const paramsFor = (fact: Fact): PlanParams => {
    if (serializeRules.length === 0) return params;
    const key = encodeId(fact.id);
    const cached = paramsCache.get(key);
    if (cached !== undefined) return cached;
    let merged = params;
    for (const rule of serializeRules) {
      if (factMatches(rule.match, fact, desired)) {
        merged = { ...rule.params, ...params };
        break;
      }
    }
    paramsCache.set(key, merged);
    return merged;
  };

  const emitCreate = (fact: Fact, base: FactBase): void => {
    const specs = rulesFor(fact.id.kind).create(fact, base, paramsFor(fact));
    specs.forEach((spec, i) => {
      pushAction("create", spec, {
        produces: i === 0 ? [fact.id] : [],
        consumes: [
          ...(i === 0 ? [] : [fact.id]),
          ...(fact.parent !== undefined ? [fact.parent] : []),
        ],
      });
    });
  };

  // renames: one action renames the whole subtree — produces every new id,
  // destroys every old id; dependents order against those sets. Tracked so
  // buildActionGraph can treat them as identity-only: a rename does NOT
  // establish or tear down the owner edge (PostgreSQL preserves the owner across
  // RENAME), so owner edges on the renamed subtree must not drive graph ordering
  // through the rename (review P1 #2: rename/rename cycle).
  const renameActionIndices = new Set<number>();
  for (const { from, to } of acceptedRenames) {
    const rename = rulesFor(from.id.kind).rename;
    if (rename === undefined) {
      throw new Error(
        `rename: kind '${from.id.kind}' matched as candidate but has no rename rule`,
      );
    }
    renameActionIndices.add(
      pushAction("alter", rename(from, to.id), {
        produces: subtreeIds(desired, to.id),
        destroys: subtreeIds(source, from.id),
        consumes: to.parent !== undefined ? [to.parent] : [],
      }),
    );
  }

  // replaces: drop old + create new (+ recreate unchanged descendants).
  // Emitted BEFORE the added-creates loop so a replaced parent's CREATE registers
  // its inlined delta-set children (publication members, etc.) in `producerOf`
  // first — the added loop's producerOf check then suppresses the redundant
  // standalone create of a child the replacement already materialized (a member
  // ADDed by CREATE … FOR TABLE must not also emit ALTER PUBLICATION ADD TABLE).
  // Emission order does not affect apply order (the action graph re-sorts).
  const recreatedByReplace = new Set<string>();
  for (const key of replaceIds) {
    const oldFact = source.getByEncoded(key) as Fact;
    // the replacement is rendered from the PROJECTED plan target, so a filtered
    // attribute change or child fact is not baked into the recreated SQL (P1 #1)
    const newFact = projectedDesired.getByEncoded(key) as Fact;
    // old descendants die with the drop
    const oldDescendants: StableId[] = [oldFact.id];
    const walkOld = (id: StableId): void => {
      for (const child of source.childrenOf(id)) {
        oldDescendants.push(child.id);
        walkOld(child.id);
      }
    };
    walkOld(oldFact.id);
    const dropSpec = rulesFor(oldFact.id.kind).drop(oldFact);
    pushAction("drop", dropSpec, {
      consumes: oldFact.parent !== undefined ? [oldFact.parent] : [],
      destroys: oldDescendants,
    });
    emitCreate(newFact, projectedDesired);
    // recreate surviving descendants from the PROJECTED plan target (satellites,
    // sub-facts). Descendants with their own attribute deltas are covered: the
    // create renders the projected payload, so their alters are skipped; a
    // descendant whose add was policy-filtered is absent and so not recreated.
    const recreate = (id: StableId): void => {
      for (const child of projectedDesired.childrenOf(id)) {
        const childKey = encodeId(child.id);
        if (added.has(childKey)) continue; // already created via add delta
        // already materialized by an ancestor's create via `alsoProduces`
        // (delta-set inlining — e.g. a validated CHECK inlined into CREATE
        // DOMAIN, a partitioned table's columns): don't recreate it as a
        // standalone action (which would duplicate it and fail apply), but still
        // descend for any non-inlined descendants. Mirrors the added-create loop.
        if (producerOf.has(childKey)) {
          recreate(child.id);
          continue;
        }
        recreatedByReplace.add(childKey);
        emitCreate(child, projectedDesired);
        recreate(child.id);
      }
    };
    recreate(newFact.id);
  }

  // creates — parents first, so a parent's delta-set inlining (e.g. a
  // partitioned table's columns rendered inside its CREATE, registered via
  // alsoProduces) is visible before its children are considered
  const depthOf = (fact: Fact): number => {
    let depth = 0;
    let parent = fact.parent;
    while (parent !== undefined) {
      depth++;
      parent = desired.get(parent)?.parent;
    }
    return depth;
  };
  for (const fact of [...added.values()].sort(
    (a, b) => depthOf(a) - depthOf(b),
  )) {
    if (producerOf.has(encodeId(fact.id))) continue;
    // EMISSION sees the PROJECTED plan target, not full `desired`: a child fact
    // whose own add delta was policy-filtered (a column's DEFAULT, a partitioned
    // table's column, a composite type's attribute, a publication's relation) is
    // absent here, so create rules cannot inline it via `alsoProduces` (review
    // P1 #1). buildActionGraph still reads un-projected `desired` for the
    // missing-requirement invariant — the two views are deliberately distinct
    // (docs/roadmap/tier-3-engine-refactors.md §1).
    emitCreate(fact, projectedDesired);
  }

  // create-produces-its-fact invariant (review architecture rec #2): every
  // worklist `add` must be materialized by a producing action — either its own
  // create or a parent's `alsoProduces` inlining. A create rule that returns no
  // producing action would otherwise surface only later as a missing-requirement
  // (or, like the role-config bug, silently lose payload). This is the
  // STRUCTURAL floor of "a create materializes the desired fact"; full per-kind
  // payload materialization (e.g. role GUC config) is each create rule's own
  // contract, pinned by its rule test.
  for (const fact of added.values()) {
    if (!producerOf.has(encodeId(fact.id))) {
      throw new Error(
        `emit invariant: added fact ${encodeId(fact.id)} (kind '${fact.id.kind}') ` +
          `is not materialized by any create action — its create rule must produce it`,
      );
    }
  }

  // default-privilege hygiene: objects created under active default ACLs receive
  // implicit grants; revoke them when the desired state has no corresponding acl
  // fact (pg_dump-style clean slate). EMISSION reads the PROJECTED plan target,
  // not full `desired` (review P1 #3): a policy can filter the default-privilege
  // add AND its grantee role, and the hygiene REVOKE must not surface a
  // filtered-away role (which would then fail the planner's own
  // missing-requirement check). Mirrors the create/alter seam.
  //
  // Hygiene covers every fact this plan CREATES on the target: added facts AND
  // replaced facts (drop + recreate) with their replace-recreated descendants —
  // a recreate fires active default ACLs exactly like a fresh create. The ADP
  // itself may be UNCHANGED (present on both sides, no delta) yet still inject
  // a grant the desired object never had, because on the source the object
  // predated the ADP (regression: the Supabase baseline's replaced
  // extensions.grant_pg_net_access() acquired a stale `postgres` grant from the
  // image's pre-existing default privileges).
  const hygieneTargets: Fact[] = [...added.values()];
  for (const key of [...replaceIds, ...recreatedByReplace]) {
    const fact = projectedDesired.getByEncoded(key);
    if (fact) hygieneTargets.push(fact);
  }
  for (const fact of hygieneTargets) {
    // which pg_default_acl objtype this kind maps to is declared per-kind in the
    // rule table (`defaclObjtype`); absent → no default ACLs
    const objtype = ruleFlag(fact.id.kind, "defaclObjtype");
    if (objtype === undefined) continue;
    // a created object whose fact is absent from the projected target (its add
    // was effectively reverted) has no hygiene to do
    if (!projectedDesired.has(fact.id)) continue;
    // owner is now an edge, not a payload field (move 2)
    const ownerEdge = projectedDesired
      .outgoingEdges(fact.id)
      .find((e) => e.kind === "owner");
    const owner =
      ownerEdge?.to.kind === "role"
        ? (ownerEdge.to as { kind: "role"; name: string }).name
        : undefined;
    if (typeof owner !== "string") continue;
    const schema = (fact.id as { schema?: string }).schema ?? null;
    for (const dp of projectedDesired.facts()) {
      if (dp.id.kind !== "defaultPrivilege") continue;
      const dpid = dp.id as {
        role: string;
        schema: string | null;
        objtype: string;
        grantee: string;
      };
      if (dpid.role !== owner || dpid.objtype !== objtype) continue;
      if (dpid.schema != null && dpid.schema !== schema) continue;
      if (dpid.grantee === owner) continue; // the owner's implicit entry IS the default
      const aclId: StableId = {
        kind: "acl",
        target: fact.id,
        grantee: dpid.grantee,
      };
      // an explicit acl in the PROJECTED target recreates the grant with a
      // REVOKE-first, so hygiene would be redundant (and a filtered acl is
      // correctly absent here → hygiene still fires)
      if (projectedDesired.has(aclId)) continue;
      pushAction(
        "alter",
        {
          sql: `REVOKE ALL ON ${grantTarget(fact.id)} FROM ${dpid.grantee === "PUBLIC" ? "PUBLIC" : qid(dpid.grantee)}`,
          consumes:
            dpid.grantee === "PUBLIC"
              ? []
              : [{ kind: "role", name: dpid.grantee } as StableId],
        },
        { consumes: [fact.id] },
      );
    }
  }

  // drops (suppressed children fold into their root's destroys)
  const destroysByRoot = new Map<string, StableId[]>();
  for (const [key, fact] of removed) {
    const root = dropRootOf.get(key) as string;
    const list = destroysByRoot.get(root) ?? [];
    list.push(fact.id);
    destroysByRoot.set(root, list);
  }
  for (const [key, fact] of removed) {
    if (dropRootOf.get(key) !== key) continue; // suppressed
    if (replaceIds.has(key)) continue; // replace handles its own drop
    const spec = rulesFor(fact.id.kind).drop(fact);
    const destroyList = destroysByRoot.get(key) ?? [fact.id];
    pushAction("drop", spec, {
      consumes: fact.parent !== undefined ? [fact.parent] : [],
      // the root fact leads: it is the action's subject (tie-break, locks)
      destroys: [fact.id, ...destroyList.filter((id) => encodeId(id) !== key)],
    });
  }

  // in-place alters (skipped for facts a replace already recreated)
  for (const [key, sets] of setsByFact) {
    if (replaceIds.has(key) || recreatedByReplace.has(key)) continue;
    // alters also render against the PROJECTED plan target: an alter that inlines
    // a child reference (ALTER COLUMN … TYPE … re-applying the desired DEFAULT,
    // REPLICA IDENTITY USING a desired index) must not surface a filtered-out
    // child (review P1 #1). `source` stays as the from-state for the rule.
    const fact = projectedDesired.get(sets[0]!.id) as Fact;
    const rules = rulesFor(fact.id.kind);
    for (const s of sets) {
      const attrRule = rules.attributes[s.attr];
      if (attrRule === undefined || attrRule === "replace") continue;
      const specs = attrRule.alter(
        fact,
        s.from,
        s.to,
        projectedDesired,
        source,
      );
      for (const spec of Array.isArray(specs) ? specs : [specs]) {
        pushAction("alter", spec, { consumes: [fact.id] });
      }
    }
  }

  // role-rename changed-pair mutations (review P2, fourth follow-up): the role
  // rename carries the fact's IDENTITY by OID, so emit only the PAYLOAD change
  // against the post-rename id — never old-name teardown + new-name create. The
  // renamed roles the new id references (`orderingConsumes`) order every emitted
  // action AFTER the `ALTER ROLE … RENAME` that produces them. We must NOT
  // consume the carried fact id itself: it is neither in `source` nor produced
  // by any action, so buildActionGraph would flag it missing.
  for (const { toFact, fromPayload, orderingConsumes } of changedRoleFacts) {
    const rules = rulesFor(toFact.id.kind);
    const alterSpecs: ActionSpec[] = [];
    let needsReplace = false;
    const attrs = new Set([
      ...Object.keys(fromPayload),
      ...Object.keys(toFact.payload),
    ]);
    for (const attr of attrs) {
      const from = fromPayload[attr];
      const to = toFact.payload[attr];
      const canon = (v: typeof from): string =>
        v === undefined ? " absent" : canonicalize(v);
      if (canon(from) === canon(to)) continue;
      const attrRule = rules.attributes[attr];
      if (attrRule === undefined || attrRule === "replace") {
        // replace-shaped attr (acl/defaultPrivilege): the whole fact is replaced
        needsReplace = true;
        continue;
      }
      const specs = attrRule.alter(toFact, from, to, projectedDesired, source);
      alterSpecs.push(...(Array.isArray(specs) ? specs : [specs]));
    }
    if (needsReplace) {
      // drop+create against the carried (post-rename) id. The drop rule reads
      // only fact.id (no `source` lookup), so it works although `to` is absent
      // from source; "destroy before re-produce" orders the drop before create.
      pushAction("drop", rules.drop(toFact), {
        destroys: [toFact.id],
        consumes: orderingConsumes,
      });
      const createSpecs = rules.create(
        toFact,
        projectedDesired,
        paramsFor(toFact),
      );
      createSpecs.forEach((spec, i) => {
        pushAction("create", spec, {
          produces: i === 0 ? [toFact.id] : [],
          consumes: [...(i === 0 ? [] : [toFact.id]), ...orderingConsumes],
        });
      });
    } else {
      for (const spec of alterSpecs) {
        pushAction("alter", spec, { consumes: orderingConsumes });
      }
    }
  }

  // owner-edge changes: emit ALTER … OWNER TO from link/unlink deltas (move 2:
  // owner is now an edge, not a payload attribute)
  {
    // collect old owner roles per fact so the link action can release them
    const oldOwnerByFact = new Map<string, StableId>();
    for (const delta of deltas) {
      if (delta.verb !== "unlink" || delta.edge.kind !== "owner") continue;
      oldOwnerByFact.set(encodeId(delta.edge.from), delta.edge.to);
    }
    // `roleRenameMap` (source role name → dest) is reused: a table owned by
    // `old` and renamed alongside keeps the SAME owner OID, surfacing in
    // `desired` as `new` — so the owner is CARRIED by the two renames, not
    // changed. Accepted renames carry ownership: `ALTER … RENAME` never changes
    // the owner, so the renamed subtree's owner edge resurfaces as a fresh link
    // in the desired base even when nothing changed. Map each renamed-to id to
    // the owner its rename-from counterpart held in source — projected THROUGH
    // any accepted role rename, so a table+owner-role pair both renamed reads as
    // an unchanged owner (the renames carry it; no `ALTER … OWNER TO`, and no
    // rename/rename cycle — review P1 #2). A genuinely changed owner still
    // emits. Subtree ids zip by index — the rename matched on a structural
    // rollup.
    const renamedOwner = new Map<string, string | null>();
    // and the OLD owner's StableId, so a genuinely-changed owner's link action
    // can `releases` it (the source-side unlink is keyed by the OLD id, which
    // the destination link never looks up — review P1 #1: drop old role too
    // early).
    const renamedOwnerId = new Map<string, StableId>();
    for (const { from, to } of acceptedRenames) {
      const srcIds = subtreeIds(source, from.id);
      const dstIds = subtreeIds(desired, to.id);
      for (let i = 0; i < dstIds.length; i++) {
        const srcId = srcIds[i];
        const dstId = dstIds[i];
        if (srcId === undefined || dstId === undefined) continue;
        const ownerEdge = source
          .outgoingEdges(srcId)
          .find((e) => e.kind === "owner");
        if (ownerEdge?.to.kind !== "role") {
          renamedOwner.set(encodeId(dstId), null);
          continue;
        }
        const srcOwnerName = (ownerEdge.to as { name: string }).name;
        renamedOwner.set(
          encodeId(dstId),
          roleRenameMap.get(srcOwnerName) ?? srcOwnerName,
        );
        renamedOwnerId.set(encodeId(dstId), ownerEdge.to);
      }
    }
    // objKeys whose owner a link delta already (re-)established below, so the
    // replaced-fact pass does not emit a second ALTER … OWNER TO for them.
    const ownerEmitted = new Set<string>();
    for (const delta of deltas) {
      if (delta.verb !== "link" || delta.edge.kind !== "owner") continue;
      const objId = delta.edge.from;
      const objKey = encodeId(objId);
      // Created objects need this too: create no longer sets the owner (move 2),
      // so a fresh object owned by a non-applier role needs an explicit
      // ALTER … OWNER TO, ordered after its create (consumes: [objId]) and after
      // the role. An owner role projected out of the view has no edge here (it
      // was pruned), so the object is left applier-owned — skipAuthorization
      // elimination falls out for free.
      const fact = desired.get(objId);
      if (!fact) continue;
      const ownerAlterPrefix = ruleFlag(fact.id.kind, "ownerAlterPrefix");
      if (!ownerAlterPrefix) continue;
      const prefix = ownerAlterPrefix(fact);
      const newRoleId = delta.edge.to;
      if (newRoleId.kind !== "role") continue;
      const roleName = (newRoleId as { kind: "role"; name: string }).name;
      // ownership carried unchanged by an accepted OBJECT rename (the object id
      // changed; renamedOwner maps it through any role rename) — no action
      if (renamedOwner.get(objKey) === roleName) continue;
      // ownership carried by an accepted ROLE rename on a STABLE object: the
      // owner edge relinks r1→r2 on the same id, but PostgreSQL carries it by
      // OID. Skip BEFORE the capability check — there is no owner action to
      // authorize (third follow-up review P1: role-only rename cycle / false
      // capability failure). The general role-rename carry seam decided this.
      if (carriedOwnerLinks.has(ownerEdgeKey(objId, newRoleId))) continue;
      // Owner residue (move 6): `ALTER … OWNER TO R` requires the applier to be
      // a superuser or a member of R. If a capability is supplied and the
      // applier cannot, fail fast at plan time with an actionable message —
      // surfaced before any statement runs, and avoiding a non-converging
      // "leave it applier-owned" (the owner is acldefault-relative). Unset only
      // for owner CHANGES/creates (this is an owner link delta), not pre-existing
      // unchanged ownership.
      if (capability !== undefined && !canSetOwner(capability, roleName)) {
        throw new Error(
          `capability: cannot set owner of ${encodeId(objId)} to role "${roleName}" — applier "${capability.role}" is not a superuser or a member of that role; grant membership or apply as a member/superuser`,
        );
      }
      // for an accepted rename the source-side owner unlink is keyed by the OLD
      // id, so `oldOwnerByFact` (keyed by the link's `from`, i.e. the NEW id) has
      // no entry — fall back to the owner the renamed subtree carried in source
      // (review P1 #1), so the release edge orders this before the old role drop.
      const oldRoleId =
        oldOwnerByFact.get(objKey) ?? renamedOwnerId.get(objKey);
      pushAction(
        "alter",
        {
          sql: `${prefix} OWNER TO ${qid(roleName)}`,
          consumes: [newRoleId],
          ...(oldRoleId !== undefined ? { releases: [oldRoleId] } : {}),
        },
        { consumes: [objId] },
      );
      ownerEmitted.add(objKey);
    }

    // Replaced facts (drop + recreate) revert to the applying role's ownership;
    // their owner edge is UNCHANGED source->target so it produced no owner link
    // delta above. Re-establish it from the PROJECTED target for every replaced
    // fact (and any descendant a replace recreated) a link delta did not already
    // own — mirroring how the replace loop recreates child ACL facts. Without
    // this, a function/type/table whose body/definition changed is silently
    // re-owned to whoever runs the migration (regression: Supabase auth.uid() et
    // al., owned by supabase_auth_admin, reverted to the applier after replace).
    for (const key of [...replaceIds, ...recreatedByReplace]) {
      if (ownerEmitted.has(key)) continue;
      const fact = projectedDesired.getByEncoded(key);
      if (!fact) continue;
      const ownerAlterPrefix = ruleFlag(fact.id.kind, "ownerAlterPrefix");
      if (!ownerAlterPrefix) continue;
      const ownerEdge = projectedDesired
        .outgoingEdges(fact.id)
        .find((e) => e.kind === "owner");
      if (ownerEdge?.to.kind !== "role") continue;
      const roleName = (ownerEdge.to as { kind: "role"; name: string }).name;
      if (capability !== undefined && !canSetOwner(capability, roleName)) {
        throw new Error(
          `capability: cannot set owner of ${key} to role "${roleName}" — ` +
            `applier "${capability.role}" is not a superuser or a member of that role; ` +
            `grant membership or apply as a member/superuser`,
        );
      }
      pushAction(
        "alter",
        {
          sql: `${ownerAlterPrefix(fact)} OWNER TO ${qid(roleName)}`,
          consumes: [ownerEdge.to],
        },
        { consumes: [fact.id] },
      );
    }
  }

  return {
    actions,
    producerOf,
    destroyerOf,
    foldHints,
    acceptsFolds,
    renameActionIndices,
  };
}
