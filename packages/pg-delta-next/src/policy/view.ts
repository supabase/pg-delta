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
} from "../core/fact.ts";
import { encodeId, isSatelliteId, type StableId } from "../core/stable-id.ts";

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
  const keptEdges: DependencyEdge[] = fb.edges.filter(
    (e) => survives.has(encodeId(e.from)) && survives.has(encodeId(e.to)),
  );
  return buildFactBase(keptFacts, keptEdges, fb.source);
}

/** Management scope of a declarative apply (target-architecture §scope). */
export type ManagementScope = "database" | "cluster";

/**
 * Project a fact base to the given management scope.
 *
 * `"cluster"` returns `fb` unchanged (roles/memberships are managed state).
 *
 * `"database"` (the declarative default) removes `role` and `membership` facts —
 * and, via edge pruning, the `owner` edges that point at them. Roles are
 * cluster-global and shared across databases, so on a shared/co-located shadow
 * the extract carries roles the declarative files never declared; diffing them
 * would plan a spurious `CREATE ROLE` (shadow-only role) or a destructive
 * `DROP ROLE` (target-only role). In database scope the caller instead passes
 * the target's actual role names as `assumedRoles`, so a `GRANT … TO <role>`
 * resolves against a role that exists at apply time (and one that does NOT fails
 * loudly at plan time). Object ownership is therefore not managed in this scope;
 * use `"cluster"` (with an isolated shadow) to manage roles and ownership.
 *
 * Symmetric by construction (same projection on both diff sides + the proof/
 * fingerprint re-extract), so `plan == prove == run` holds.
 */
export function projectManagementScope(
  fb: FactBase,
  scope: ManagementScope,
): FactBase {
  if (scope === "cluster") return fb;
  const roots = new Set<string>();
  for (const fact of fb.facts()) {
    if (fact.id.kind === "role" || fact.id.kind === "membership") {
      roots.add(encodeId(fact.id));
    }
  }
  return excludeFactsAndDescendants(fb, roots);
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
