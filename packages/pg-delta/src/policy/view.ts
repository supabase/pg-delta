/**
 * The single fact-level projection primitive behind the managed view
 * (docs/architecture/managed-view-architecture.md).
 *
 * The engine diffs a *view* of the managed universe, never raw catalogs, and a
 * view is closed under the proof loop: a fact removed from one side is removed
 * from the other and from the proof re-extract, so `plan == prove == run` holds
 * by construction. Projection is therefore always at the FACT level (both sides
 * + the proof re-extract), never the delta level — a delta-only filter would
 * make the proof drift.
 *
 * `excludeByProvenance(fb, "managedBy")` HARD-projects operationally-managed
 * objects out. Extension members (`memberOfExtension`) are NOT hard-pruned — they
 * are kept REFERENCE-ONLY via `extensionMemberClosure` / `extensionMemberReferenceOnly`
 * so their satellite customizations still diff. Scope and applier-capability
 * projections (later moves) reuse `excludeFactsAndDescendants` with roots chosen
 * a different way.
 */
import {
  buildFactBase,
  type DependencyEdge,
  type EdgeKind,
  type Fact,
  type FactBase,
  retainOwnerRoleDangling,
} from "../core/fact.ts";
import { encodeId, isSatelliteId, type StableId } from "../core/stable-id.ts";

export type ProjectionAuditStage =
  | "baseline"
  | "policyScopeRule"
  | "capability"
  | "managementScope"
  | "referenceOnly"
  | "managedBy";

export type ProjectionAuditClassification = "acknowledged" | "suspicious";

export type ProjectionAuditSubject =
  | { kind: "fact"; id: StableId }
  | { kind: "edge"; edge: DependencyEdge };

export interface ProjectionSuppression {
  subject: ProjectionAuditSubject;
  stage: ProjectionAuditStage;
  reasonCode: string;
  classification: ProjectionAuditClassification;
  viaDescendantOf?: StableId;
}

export type ProjectionSuppressionCollector = (
  suppression: ProjectionSuppression,
) => void;

export type ProjectionSuppressionAttribution = Omit<
  ProjectionSuppression,
  "subject" | "viaDescendantOf"
>;

const edgeKey = (edge: DependencyEdge): string =>
  `${encodeId(edge.from)}|${edge.kind}|${encodeId(edge.to)}`;

/** Emit fact + independently-pruned-edge suppression records for a projection.
 * The root map names the actual exclusion decisions; collateral descendants
 * point back to that decision through `viaDescendantOf`. Kept off the normal
 * projection hot path unless a caller explicitly supplies a collector. */
export function collectRemovedSuppressions(
  before: FactBase,
  after: FactBase,
  roots: ReadonlyMap<string, ProjectionSuppressionAttribution>,
  collect: ProjectionSuppressionCollector,
): void {
  const rootFor = (
    id: StableId,
  ):
    | { id: StableId; attribution: ProjectionSuppressionAttribution }
    | undefined => {
    let cursor: StableId | undefined = id;
    while (cursor !== undefined) {
      const attribution = roots.get(encodeId(cursor));
      if (attribution !== undefined) return { id: cursor, attribution };
      cursor = before.get(cursor)?.parent;
    }
    return undefined;
  };

  for (const fact of before.facts()) {
    if (after.has(fact.id)) continue;
    const root = rootFor(fact.id);
    if (root === undefined) continue;
    collect({
      subject: { kind: "fact", id: fact.id },
      ...root.attribution,
      ...(encodeId(root.id) === encodeId(fact.id)
        ? {}
        : { viaDescendantOf: root.id }),
    });
  }

  const survivingEdges = new Set(after.edges.map(edgeKey));
  for (const edge of before.edges) {
    if (survivingEdges.has(edgeKey(edge))) continue;
    const rootsForEdge = [rootFor(edge.from), rootFor(edge.to)].filter(
      (
        root,
      ): root is {
        id: StableId;
        attribution: ProjectionSuppressionAttribution;
      } => root !== undefined,
    );
    const emitted = new Set<string>();
    for (const root of rootsForEdge) {
      const causeKey = `${encodeId(root.id)}|${root.attribution.stage}|${root.attribution.reasonCode}`;
      if (emitted.has(causeKey)) continue;
      emitted.add(causeKey);
      const directlyTouchesRoot =
        encodeId(edge.from) === encodeId(root.id) ||
        encodeId(edge.to) === encodeId(root.id);
      collect({
        subject: { kind: "edge", edge },
        ...root.attribution,
        ...(directlyTouchesRoot ? {} : { viaDescendantOf: root.id }),
      });
    }
  }
}

/**
 * Return a new FactBase with `rootIds` and their entire descendant subtrees
 * removed; edges with a removed endpoint are pruned. If `rootIds` is empty, `fb`
 * is returned unchanged (referential identity preserved for cheap no-ops).
 */
export function excludeFactsAndDescendants(
  fb: FactBase,
  rootIds: ReadonlySet<string>,
): FactBase {
  if (rootIds.size === 0) return fb;

  const removed = new Set<string>();
  // a fact is removed if it is a root, or any ancestor is one
  const isRemoved = (fact: Fact): boolean => {
    const encoded = encodeId(fact.id);
    if (removed.has(encoded)) return true;
    if (rootIds.has(encoded)) {
      removed.add(encoded);
      return true;
    }
    let current = fact.parent;
    while (current !== undefined) {
      const key = encodeId(current);
      if (rootIds.has(key) || removed.has(key)) {
        removed.add(encoded);
        return true;
      }
      current = fb.get(current)?.parent;
    }
    return false;
  };

  const keptFacts: Fact[] = fb.facts().filter((f) => !isRemoved(f));
  const survives = new Set(keptFacts.map((f) => encodeId(f.id)));
  const keptEdges: DependencyEdge[] = fb.edges.filter((e) => {
    const fromSurvives = survives.has(encodeId(e.from));
    if (fromSurvives && survives.has(encodeId(e.to))) return true;
    // Ownership carve-out invariant: PRESERVE an owner→role edge that was
    // ALREADY dangling on input (e.g. a scope projection re-run through this
    // primitive keeps serializing OWNER TO instead of silently dropping it),
    // but NEVER newly dangle an edge whose endpoint THIS exclusion removes.
    // Minting a fresh dangling owner edge for a role THIS call is projecting out
    // (e.g. a policy hard-exclusion) would launder the excluded role back in as
    // `CREATE SCHEMA … AUTHORIZATION <role>` / `OWNER TO <role>` (auto-assumed in
    // plan.ts) and silence the missing-requirement guard. Only
    // `projectManagementScope` (its own edge loop) is entitled to mint dangling
    // owner edges.
    return fromSurvives && retainOwnerRoleDangling(e) && !fb.has(e.to);
  });
  // Carry the reference-only set forward for surviving facts. Otherwise a scope
  // or provenance projection (which rebuilds the FactBase) silently drops the
  // reference-only marks resolveView() set, so extension members and
  // assumed-schema platform objects become managed again and get planned/dropped.
  const referenceOnly = new Set(
    [...fb.referenceOnly].filter((key) => survives.has(key)),
  );
  return buildFactBase(keptFacts, keptEdges, fb.source, referenceOnly, {
    allowDangling: retainOwnerRoleDangling,
  });
}

/** Management scope of a declarative apply (target-architecture §scope). */
export type ManagementScope = "database" | "cluster";

/**
 * Encoded ids removed by excluding `rootIds` and their descendant subtrees (a
 * fact is removed if it is a root or has a removed ancestor). Mirrors the
 * removal walk in `excludeFactsAndDescendants`; used by `projectManagementScope`
 * so it agrees on the removal closure while handling edges specially.
 */
function removedClosure(
  fb: FactBase,
  rootIds: ReadonlySet<string>,
): Set<string> {
  const removed = new Set<string>();
  const isRemoved = (fact: Fact): boolean => {
    const encoded = encodeId(fact.id);
    if (removed.has(encoded)) return true;
    if (rootIds.has(encoded)) {
      removed.add(encoded);
      return true;
    }
    let current = fact.parent;
    while (current !== undefined) {
      const key = encodeId(current);
      if (rootIds.has(key) || removed.has(key)) {
        removed.add(encoded);
        return true;
      }
      current = fb.get(current)?.parent;
    }
    return false;
  };
  for (const fact of fb.facts()) isRemoved(fact);
  return removed;
}

/**
 * Project a fact base to the given management scope.
 *
 * `"cluster"` returns `fb` unchanged (roles/memberships are managed state).
 *
 * `"database"` (the declarative default) removes `role` and `membership` facts.
 * Roles are cluster-global and shared across databases, so on a shared/co-located
 * shadow the extract carries roles the declarative files never declared; diffing
 * them would plan a spurious `CREATE ROLE` (shadow-only role) or a destructive
 * `DROP ROLE` (target-only role). The caller instead passes the target's actual
 * role names as `assumedRoles`, so a `GRANT … TO <role>` (and, below, an
 * `ALTER … OWNER TO <role>`) resolves against a role that exists at apply time
 * (one that does NOT fails loudly at plan time).
 *
 * OWNERSHIP is still serialized in database scope: an `owner` edge from a
 * surviving object to a (removed) role is RETAINED as a dangling ASSUMED
 * reference, so ownership round-trips as `ALTER … OWNER TO`. The one exception is
 * the resolved `defaultOwner`: an owner edge to it is pruned, because that role
 * is the implicit/applier owner and emitting `OWNER TO <defaultOwner>` for every
 * object would be redundant noise. `defaultOwner` undefined (verbose /
 * `--default-owner none`) keeps EVERY retained owner edge.
 *
 * Symmetric by construction (same projection — including the same `defaultOwner`
 * — on both diff sides + the proof/fingerprint re-extract), so
 * `plan == prove == run` holds.
 */
export function projectManagementScope(
  fb: FactBase,
  scope: ManagementScope,
  opts: {
    defaultOwner?: string;
    collectSuppression?: ProjectionSuppressionCollector;
  } = {},
): FactBase {
  if (scope === "cluster") return fb;
  const roots = new Set<string>();
  for (const fact of fb.facts()) {
    if (fact.id.kind === "role" || fact.id.kind === "membership") {
      roots.add(encodeId(fact.id));
    }
  }
  if (roots.size === 0) return fb; // identity no-op (referential identity preserved)

  const removed = removedClosure(fb, roots);
  const keptFacts = fb.facts().filter((f) => !removed.has(encodeId(f.id)));
  const survives = new Set(keptFacts.map((f) => encodeId(f.id)));

  const { defaultOwner } = opts;
  const keptEdges: DependencyEdge[] = [];
  for (const e of fb.edges) {
    const fromSurvives = survives.has(encodeId(e.from));
    const toSurvives = survives.has(encodeId(e.to));
    if (fromSurvives && toSurvives) {
      keptEdges.push(e);
      continue;
    }
    // deliberate carve-out (scoped to owner→role edges): retain the owner edge
    // to a removed role as a dangling assumed reference so ownership serializes,
    // EXCEPT the edge to the resolved defaultOwner (implicit/applier owner).
    if (
      e.kind === "owner" &&
      fromSurvives &&
      !toSurvives &&
      e.to.kind === "role"
    ) {
      const roleName = (e.to as { kind: "role"; name: string }).name;
      if (defaultOwner !== undefined && roleName === defaultOwner) continue;
      keptEdges.push(e);
    }
    // every other dangling edge is pruned (as excludeFactsAndDescendants does).
  }

  const referenceOnly = new Set(
    [...fb.referenceOnly].filter((key) => survives.has(key)),
  );
  const projected = buildFactBase(
    keptFacts,
    keptEdges,
    fb.source,
    referenceOnly,
    {
      allowDangling: retainOwnerRoleDangling,
    },
  );
  if (opts.collectSuppression !== undefined) {
    const attribution: ProjectionSuppressionAttribution = {
      stage: "managementScope",
      reasonCode: "management-scope.database.cluster-object",
      classification: "acknowledged",
    };
    const defaultOwnerEdgeKeys = new Set<string>();
    if (defaultOwner !== undefined) {
      for (const edge of fb.edges) {
        if (
          edge.kind === "owner" &&
          edge.to.kind === "role" &&
          (edge.to as { kind: "role"; name: string }).name === defaultOwner &&
          survives.has(encodeId(edge.from))
        ) {
          defaultOwnerEdgeKeys.add(edgeKey(edge));
        }
      }
    }
    collectRemovedSuppressions(
      fb,
      projected,
      new Map([...roots].map((key) => [key, attribution])),
      (suppression) => {
        if (
          suppression.subject.kind === "edge" &&
          defaultOwnerEdgeKeys.has(edgeKey(suppression.subject.edge))
        ) {
          return;
        }
        opts.collectSuppression?.(suppression);
      },
    );
    if (defaultOwner !== undefined) {
      const projectedEdges = new Set(projected.edges.map(edgeKey));
      for (const edge of fb.edges) {
        if (
          edge.kind === "owner" &&
          edge.to.kind === "role" &&
          (edge.to as { kind: "role"; name: string }).name === defaultOwner &&
          survives.has(encodeId(edge.from)) &&
          !projectedEdges.has(edgeKey(edge))
        ) {
          opts.collectSuppression({
            subject: { kind: "edge", edge },
            stage: "managementScope",
            reasonCode: "management-scope.database.default-owner",
            classification: "acknowledged",
          });
        }
      }
    }
  }
  return projected;
}

/**
 * Extension-member closure: every fact an extension OWNS → the owning
 * extension id(s). A member root is any fact with an outgoing `memberOfExtension`
 * edge (pushMemberEdge tags functions/tables/types/schemas/…). Ownership then
 * flows DOWN to a root's NON-satellite descendants (a member table's columns/
 * constraints are extension-managed too), EXCEPT it does NOT cross a `schema`
 * root's children: an extension owns the schema it creates, but a USER object
 * added inside that schema carries no member edge of its own and must diff
 * normally. Satellites (acl/comment/securityLabel — `isSatelliteId`) are never
 * in the closure: a user GRANT/COMMENT/SECURITY LABEL on an extension object is
 * user state that the diff DOES manage.
 *
 * Memoized by construction (BFS visits each id once), unlike a per-fact
 * ancestor walk. Used both to mark members reference-only in the view and to
 * exempt them from the planner's requirement guard (they are present-at-apply
 * via CREATE EXTENSION), keeping ONE definition of "member" on both sides.
 */
export function extensionMemberClosure(fb: FactBase): Map<string, StableId[]> {
  const closure = new Map<string, StableId[]>();
  const queue: StableId[] = [];
  for (const fact of fb.facts()) {
    const exts = fb
      .outgoingEdges(fact.id)
      .filter((e) => e.kind === "memberOfExtension")
      .map((e) => e.to);
    if (exts.length > 0) {
      closure.set(encodeId(fact.id), exts);
      queue.push(fact.id);
    }
  }
  while (queue.length > 0) {
    const id = queue.pop() as StableId;
    if (id.kind === "schema") continue; // schema boundary (see doc above)
    const exts = closure.get(encodeId(id)) as StableId[];
    for (const child of fb.childrenOf(id)) {
      if (isSatelliteId(child.id)) continue;
      const key = encodeId(child.id);
      if (closure.has(key)) continue;
      closure.set(key, exts);
      queue.push(child.id);
    }
  }
  return closure;
}

/** Encoded ids to mark REFERENCE-ONLY for extension members — the member
 *  objects (and their non-satellite descendants) from `extensionMemberClosure`.
 *  The diff descends into a reference-only fact's children (diff.ts), so a
 *  member's satellite customizations are still compared while the member object
 *  itself never becomes a create/drop/alter action. */
export function extensionMemberReferenceOnly(fb: FactBase): Set<string> {
  return new Set(extensionMemberClosure(fb).keys());
}

/**
 * Project OUT every fact carrying an outgoing edge of `edgeKind`, plus its
 * descendant subtree. Roots are selected by provenance; the removal + edge
 * pruning is `excludeFactsAndDescendants`.
 */
export function excludeByProvenance(
  fb: FactBase,
  edgeKind: EdgeKind,
): FactBase {
  const roots = new Set<string>();
  for (const fact of fb.facts()) {
    if (fb.outgoingEdges(fact.id).some((e) => e.kind === edgeKind)) {
      roots.add(encodeId(fact.id));
    }
  }
  return excludeFactsAndDescendants(fb, roots);
}
