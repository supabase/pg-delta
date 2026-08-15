/**
 * Per-kind graph/suppression flags read from the rule table (guardrail 3): the
 * planner body and its phases hold NO kind-name lists — they ask the rule table.
 * `rulesFor` throws for unknown kinds, so `ruleFlag` guards it and the boolean
 * accessors default to false.
 *
 * This stays keyed on the kind STRING (not an id resolver): every flag it serves
 * (`cascadesToChildren`, `rebuildable`, and via callers `defaclObjtype`,
 * `ownerAlterPrefix`) must be `undefined`/false for the `extensionIntent` kind —
 * intent facts have no children, are not rebuildable, have no default ACLs, and
 * are not ownable. `rulesFor("extensionIntent")` throws → the catch returns
 * undefined, which is exactly the correct answer, so no intent-aware resolver is
 * needed here.
 */
import type { KindRules } from "./rules.ts";
import { rulesFor } from "./rules.ts";

export function ruleFlag<K extends keyof KindRules>(
  kind: string,
  flag: K,
): KindRules[K] | undefined {
  try {
    return rulesFor(kind)[flag];
  } catch {
    return undefined;
  }
}

export const cascadesToChildren = (kind: string): boolean =>
  ruleFlag(kind, "cascadesToChildren") === true;

export const isRebuildable = (kind: string): boolean =>
  ruleFlag(kind, "rebuildable") === true;

export const isMetadataKind = (kind: string): boolean =>
  ruleFlag(kind, "metadata") === true;
