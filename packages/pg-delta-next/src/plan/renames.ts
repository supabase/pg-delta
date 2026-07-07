/**
 * Rename detection (target-architecture §4.1, stage 9): over the diff's
 * remove/add pairs, find candidates whose STRUCTURAL rollup (the
 * identity-free fold from stage 1) matches — same content, different name.
 * A rename rewrites the whole subtree's IDs without emitting subtree
 * actions, and preserves data by construction.
 *
 * Never guess: ambiguity (n removed × m added with equal rollups) and
 * swaps/chains (the target name already exists in the source) are
 * surfaced for the policy gate to resolve, not auto-applied.
 *
 * Known limit (§4.1, documented in the verdict): payloads referencing
 * other objects BY NAME (an index def naming its table, a FK naming the
 * renamed table) break transitive rollup equality — those candidates
 * degrade to drop+create and are reported as near-misses.
 */
import type { Fact, FactBase } from "../core/fact.ts";
import { encodeId, type StableId } from "../core/stable-id.ts";
import { defaultRulesForId, type RulesForId } from "./rules.ts";

export type RenameMode = "auto" | "prompt" | "off";

export interface RenameCandidate {
  kind: string;
  from: StableId;
  to: StableId;
  /**
   * - unambiguous: 1×1 structural match — auto-appliable
   * - ambiguous: several equal-rollup facts on one side — never guessed
   * - nearMiss: own payload matches but the subtree differs (usually a
   *   name-bearing child payload) — degrades to drop+create, reported why
   *
   * Swaps/chains cannot appear here BY CONSTRUCTION: an `add` delta means
   * the target id does not exist in the source, so a rename whose target
   * name is occupied surfaces as a set-delta on the occupied fact instead
   * — handled as an alter/replace, never a guessed rename (the stage-9
   * swap scenario asserts this).
   */
  status: "unambiguous" | "ambiguous" | "nearMiss";
  reason?: string;
}

function groupKey(fact: Fact, rollup: string): string {
  const parent = fact.parent === undefined ? "" : encodeId(fact.parent);
  return `${fact.id.kind}|${parent}|${rollup}`;
}

export function matchRenameCandidates(
  removed: ReadonlyMap<string, Fact>,
  added: ReadonlyMap<string, Fact>,
  source: FactBase,
  desired: FactBase,
  // id-keyed resolver so an `extensionIntent` add/remove present during rename
  // matching resolves its (rename-less) intent rule instead of throwing through
  // the schema-only `rulesFor`. Defaults to the no-intent resolver for direct
  // callers/tests that never see intent facts.
  rulesForId: RulesForId = defaultRulesForId,
): RenameCandidate[] {
  const candidates: RenameCandidate[] = [];

  const removedGroups = new Map<string, Fact[]>();
  for (const fact of removed.values()) {
    if (rulesForId(fact.id).rename === undefined) continue;
    // children of a removed/renamed container are handled by their root
    if (fact.parent !== undefined && removed.has(encodeId(fact.parent)))
      continue;
    const key = groupKey(fact, source.structuralRollupOf(fact.id));
    const list = removedGroups.get(key) ?? [];
    list.push(fact);
    removedGroups.set(key, list);
  }
  const addedGroups = new Map<string, Fact[]>();
  for (const fact of added.values()) {
    if (rulesForId(fact.id).rename === undefined) continue;
    if (fact.parent !== undefined && added.has(encodeId(fact.parent))) continue;
    const key = groupKey(fact, desired.structuralRollupOf(fact.id));
    const list = addedGroups.get(key) ?? [];
    list.push(fact);
    addedGroups.set(key, list);
  }

  const matchedRemoved = new Set<string>();
  for (const [key, removedFacts] of removedGroups) {
    const addedFacts = addedGroups.get(key);
    if (addedFacts === undefined) continue;
    if (removedFacts.length === 1 && addedFacts.length === 1) {
      const from = (removedFacts[0] as Fact).id;
      const to = (addedFacts[0] as Fact).id;
      matchedRemoved.add(encodeId(from));
      candidates.push({ kind: from.kind, from, to, status: "unambiguous" });
    } else {
      for (const removedFact of removedFacts) {
        matchedRemoved.add(encodeId(removedFact.id));
        for (const addedFact of addedFacts) {
          candidates.push({
            kind: removedFact.id.kind,
            from: removedFact.id,
            to: addedFact.id,
            status: "ambiguous",
            reason: `${removedFacts.length} removed × ${addedFacts.length} added with identical content — cannot pick`,
          });
        }
      }
    }
  }

  // near-misses: own payload identical, subtree rollup not — say why a
  // would-be rename degrades (§4.1)
  for (const fact of removed.values()) {
    if (matchedRemoved.has(encodeId(fact.id))) continue;
    if (rulesForId(fact.id).rename === undefined) continue;
    if (fact.parent !== undefined && removed.has(encodeId(fact.parent)))
      continue;
    for (const addedFact of added.values()) {
      if (addedFact.id.kind !== fact.id.kind) continue;
      const sameParent =
        (fact.parent === undefined && addedFact.parent === undefined) ||
        (fact.parent !== undefined &&
          addedFact.parent !== undefined &&
          encodeId(fact.parent) === encodeId(addedFact.parent));
      if (!sameParent) continue;
      if (source.hashOf(fact.id) !== desired.hashOf(addedFact.id)) continue;
      candidates.push({
        kind: fact.id.kind,
        from: fact.id,
        to: addedFact.id,
        status: "nearMiss",
        reason:
          "own payload matches but the subtree differs — likely a name-bearing child payload (index/constraint defs embed names, §4.1); staying drop+create",
      });
    }
  }

  return candidates.sort((a, b) => {
    const ka = `${encodeId(a.from)}>${encodeId(a.to)}`;
    const kb = `${encodeId(b.from)}>${encodeId(b.to)}`;
    return ka < kb ? -1 : 1;
  });
}

/** A fact id plus every descendant id, root first. */
export function subtreeIds(fb: FactBase, root: StableId): StableId[] {
  const ids: StableId[] = [root];
  const walk = (id: StableId): void => {
    for (const child of fb.childrenOf(id)) {
      ids.push(child.id);
      walk(child.id);
    }
  };
  walk(root);
  return ids;
}
