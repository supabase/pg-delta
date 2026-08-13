/**
 * Planner phase 2 — ReplacementExpansion (target-architecture §3.4–3.5).
 *
 * Given the grouped change set, decides which facts are REPLACED (drop +
 * recreate) versus altered in place, expands the forced dependent rebuild, and
 * computes drop-root suppression/redirect. Pure over its inputs; produces the
 * `replaceIds` set and the `dropRootOf` map the emitter consumes. Extracted from
 * `plan()` so the replace/rebuild/suppression invariants live behind one named
 * boundary instead of inline.
 */
import type { Delta } from "../../core/diff.ts";
import type { Fact, FactBase } from "../../core/fact.ts";
import { encodeId, type StableId } from "../../core/stable-id.ts";
import { cascadesToChildren, isRebuildable } from "../rule-flags.ts";
import type { RulesForId } from "../rules.ts";

export interface ReplacementExpansionInput {
  /** removed facts keyed by encoded id (ordinary rename cancellation applied) */
  removed: ReadonlyMap<string, Fact>;
  /** set-deltas grouped by encoded fact id */
  setsByFact: ReadonlyMap<string, Extract<Delta, { verb: "set" }>[]>;
  /** resolved source / desired views */
  source: FactBase;
  desired: FactBase;
  /** id-keyed rule resolver (schema kinds + `extensionIntent`) */
  rulesForId: RulesForId;
}

export interface ReplacementExpansion {
  /** encoded ids the planner replaces (drop old + recreate from desired) */
  replaceIds: Set<string>;
  /** encoded id → encoded id of the drop action that subsumes it (suppression) */
  dropRootOf: Map<string, string>;
}

/**
 * Classify set-deltas (in-place alter vs replace), expand the forced dependent
 * rebuild, then compute drop-root suppression + redirect. Behavior-preserving
 * extraction of `plan()`'s replacement/suppression block.
 */
export function expandReplacements(
  input: ReplacementExpansionInput,
): ReplacementExpansion {
  const { removed, setsByFact, source, desired, rulesForId } = input;

  // ── classify set-deltas: in-place alter vs replace ────────────────────
  const replaceIds = new Set<string>();
  // alters that invalidate dependents (e.g. an enum value-set replacement, or an
  // ALTER COLUMN TYPE that views/policies reference) seed the forced-rebuild
  // pass without replacing the fact itself. The value is the set of dependent
  // kinds to rebuild (null = all rebuildable kinds).
  const rebuildSeeds = new Map<string, ReadonlySet<string> | null>();
  for (const [key, sets] of setsByFact) {
    const fact = desired.get(sets[0]!.id) as Fact;
    const rules = rulesForId(fact.id);
    for (const s of sets) {
      const attrRule = rules.attributes[s.attr];
      if (attrRule === undefined) {
        throw new Error(
          `rule table: kind '${fact.id.kind}' has no rule for attribute '${s.attr}' (${key}) — extend the rule vocabulary (guardrail 3)`,
        );
      }
      if (attrRule === "replace") {
        replaceIds.add(key);
        continue;
      }
      // a transition with no in-place ALTER grammar routes the whole fact to
      // replace (drop + recreate) — its `alter` is never rendered.
      if (attrRule.replaceWhen?.(s.from, s.to, fact)) {
        replaceIds.add(key);
        continue;
      }
      const rebuild = attrRule.rebuildsDependents?.(s.from, s.to);
      if (rebuild === true) rebuildSeeds.set(key, null);
      else if (Array.isArray(rebuild)) rebuildSeeds.set(key, new Set(rebuild));
    }
  }

  // ── forced dependent rebuild (the clean expand-replace, §3.4) ─────────
  // A surviving dependent of something this plan destroys must be dropped and
  // recreated from the desired state — recursively. Which kinds are rebuildable
  // is declared per-kind in the rule table (`rebuildable`).
  {
    // `fullDestroy` ids rebuild EVERY rebuildable dependent; `rebuildSeeds` (an
    // in-place alter that invalidates only some dependent kinds) rebuild only
    // their declared kinds. Once a dependent is rebuilt it joins `fullDestroy`,
    // so its own subtree rebuilds completely.
    const fullDestroy = new Set([...removed.keys(), ...replaceIds]);
    const targets = new Set([...fullDestroy, ...rebuildSeeds.keys()]);
    // Reverse-dependency reachability from the initial targets, instead of
    // rescanning every source edge each fixpoint round (O(reachable) vs
    // O(edges × rounds)). Same checks/precedence as the fixpoint: a dependent of
    // a destroyed/replaced fact (or a kind-restricted seed) that is rebuildable
    // and survives in `desired` is replaced, and itself becomes a full-destroy
    // target so its own subtree rebuilds.
    const worklist = [...targets];
    while (worklist.length > 0) {
      const toKey = worklist.pop() as string;
      for (const edge of source.incomingEdgesByEncoded(toKey)) {
        const fromKey = encodeId(edge.from);
        if (targets.has(fromKey)) continue;
        const dependent = source.get(edge.from);
        if (!dependent || !desired.has(edge.from)) continue;
        // A REFERENCE-ONLY dependent (an extension member, or a non-satellite
        // descendant of one) is never a standalone action: it vanishes with its
        // extension's DROP (`alsoDestroys`) and re-materializes with the
        // CREATE. Promoting it into `replaceIds` emits member DROP/CREATE
        // statements PostgreSQL rejects outright — and, across an extension
        // replace, wedges the action graph (the pg_net member cycle,
        // guardrail 4). Reached via its `memberOfExtension` edge when the
        // extension itself is replaced, or via a `depends` edge into any other
        // destroyed fact. The walk still traverses THROUGH the member: its
        // non-member dependents are real casualties of the replace and must
        // rebuild (an unchanged user function calling a member function).
        if (source.isReferenceOnly(edge.from)) {
          fullDestroy.add(fromKey);
          targets.add(fromKey);
          worklist.push(fromKey);
          continue;
        }
        if (!isRebuildable(dependent.id.kind)) continue;
        // reached only via a kind-restricted seed: honor the allowed kinds
        if (!fullDestroy.has(toKey)) {
          const allowed = rebuildSeeds.get(toKey);
          if (allowed && !allowed.has(dependent.id.kind)) continue;
        }
        replaceIds.add(fromKey);
        fullDestroy.add(fromKey);
        targets.add(fromKey);
        worklist.push(fromKey);
      }
    }
    // descendants of replaced facts are handled by the ancestor's subtree
    // recreate — keep only the topmost replaced facts. Deleting the entry under
    // iteration is safe for a JS Set.
    for (const key of replaceIds) {
      const fact = source.getByEncoded(key);
      let ancestor = fact?.parent;
      while (ancestor !== undefined) {
        if (replaceIds.has(encodeId(ancestor))) {
          replaceIds.delete(key);
          break;
        }
        ancestor = source.get(ancestor)?.parent;
      }
    }
  }

  // ── suppression: child removals that cascade with an ancestor's drop ──
  // dropRootOf(id) = nearest removed ancestor whose drop action will exist. FK
  // constraint drops are NEVER suppressed: an explicit DROP CONSTRAINT before
  // the table drops makes mutual-FK teardown cycles unconstructible
  // (decomposition over repair, §3.5).
  const isRemovedId = (id: StableId): boolean => {
    const key = encodeId(id);
    return removed.has(key) || replaceIds.has(key);
  };
  const dropRootOf = new Map<string, string>();
  const findDropRoot = (fact: Fact): string => {
    const key = encodeId(fact.id);
    const cached = dropRootOf.get(key);
    if (cached) return cached;
    let root = key;
    const rules = rulesForId(fact.id);
    const suppressible = rules.suppressible?.(fact) ?? true;
    const parent = fact.parent;
    if (parent !== undefined && suppressible) {
      const parentRemoved = isRemovedId(parent);
      // a metadata satellite folds into ANY removed parent; otherwise the parent
      // kind must be one whose DROP cascades to children
      const cascades =
        rules.metadata === true || cascadesToChildren(parent.kind);
      if (parentRemoved && cascades) {
        root = findDropRoot(
          removed.get(encodeId(parent)) ?? (source.get(parent) as Fact),
        );
      }
    }
    dropRootOf.set(key, root);
    return root;
  };
  for (const fact of removed.values()) findDropRoot(fact);

  // a fact whose drop folds into a NON-parent ancestor (an OWNED BY sequence
  // into its owning column/table) — declared per-kind via dropRootRedirect.
  for (const fact of removed.values()) {
    const redirect = rulesForId(fact.id).dropRootRedirect?.(fact, isRemovedId);
    if (redirect === undefined) continue;
    const redirectKey = encodeId(redirect);
    dropRootOf.set(
      encodeId(fact.id),
      dropRootOf.get(redirectKey) ?? redirectKey,
    );
  }

  return { replaceIds, dropRootOf };
}
