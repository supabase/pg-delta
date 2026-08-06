/**
 * Preamble compaction (§3.6): decide whether a plan needs
 * `check_function_bodies = off` in its session preamble.
 *
 * The setting is load-bearing exactly when the plan defines quoted (plpgsql /
 * string-literal SQL) routine bodies: the planner deliberately records no
 * body-dependency edges for them (rules/helpers.ts `dependencyConsumes`), so a
 * forward-referencing body only elaborates because validation is off. For a
 * plan that touches no routine-family object the entry is pure noise, and
 * omitting it is a cosmetic change under the compaction contract — proof
 * results never differ, and `compact: false` restores the unconditional
 * preamble as the conservative opt-out.
 *
 * The predicate errs toward keeping the entry ("rather have it than not"):
 * it scans EVERY id an action mentions (produces / consumes / destroys /
 * releases, satellites unwrapped to their target). That is sufficient for
 * every statement that can DEFINE a body — a routine create / replace /
 * def-alter always carries its routine id in produces (and its depends
 * targets in consumes, rules/routines.ts). A statement that merely
 * REFERENCES a routine without its id in the action arrays (e.g. a table
 * trigger, whose create consumes only its parent table — the function
 * reference is a fact edge) does not keep the entry, deliberately:
 * CREATE TRIGGER never validates the function's body. Kinds:
 *   - function / procedure — the real cases (CREATE OR REPLACE with a body);
 *   - aggregate — no body of its own, kept as routine-family insurance;
 *   - extension / extensionIntent — extension scripts and intent replay run
 *     arbitrary SQL (PostgreSQL forces check_function_bodies=off inside
 *     CREATE EXTENSION scripts itself, so this is belt-and-braces).
 */
import {
  ROUTINE_KINDS,
  type FactKind,
  type StableId,
} from "../core/stable-id.ts";
import type { Action } from "./plan.ts";

const ROUTINE_FAMILY_KINDS: ReadonlySet<FactKind> = new Set<FactKind>([
  ...ROUTINE_KINDS,
  "extension",
  "extensionIntent",
]);

/** A satellite id (comment / acl / securityLabel) addresses its target
 *  object — unwrap to the base object the action actually touches. */
function baseObjectKind(id: StableId): FactKind {
  let current = id;
  while ("target" in current) current = current.target;
  return current.kind;
}

export function needsCheckFunctionBodiesOff(
  actions: ReadonlyArray<
    Pick<Action, "produces" | "consumes" | "destroys" | "releases">
  >,
): boolean {
  for (const action of actions) {
    for (const ids of [
      action.produces,
      action.consumes,
      action.destroys,
      action.releases,
    ]) {
      for (const id of ids) {
        if (ROUTINE_FAMILY_KINDS.has(baseObjectKind(id))) return true;
      }
    }
  }
  return false;
}
