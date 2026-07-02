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
 * `excludeManaged` (managedBy) and `excludeExtensionMembers` (memberOfExtension)
 * are thin wrappers over `excludeByProvenance`; scope and applier-capability
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
import { encodeId } from "../core/stable-id.ts";

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
