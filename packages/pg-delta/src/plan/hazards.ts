/**
 * Derived hazard classification over proof-verified action safety fields
 * and coverage diagnostics. Hazard kinds are a view — they are not stored
 * on Plan/Action and are not part of planId.
 *
 * Policy (which hazards block which target) stays in the caller.
 */
import type { Diagnostic } from "../core/diagnostic.ts";
import type { Action, Plan } from "./plan.ts";

export type HazardKind =
  | "data_loss"
  | "rewrite_risk"
  | "non_transactional"
  | "access_exclusive_lock"
  | "unmodeled_kind"
  | "unmodeled_drift"
  | "unresolved_security_label";

/** Stable display order for unions / reports. Frozen so a caller cannot
 *  mutate the module singleton that sortKinds() reads. */
export const HAZARD_KIND_ORDER: readonly HazardKind[] = Object.freeze([
  "data_loss",
  "rewrite_risk",
  "non_transactional",
  "access_exclusive_lock",
  "unmodeled_kind",
  "unmodeled_drift",
  "unresolved_security_label",
]);

/** Coverage-diagnostic codes, duplicated locally as HazardKind literals
 *  that match the diagnostic codes. Do not import from src/cli/**. */
const COVERAGE_KINDS = new Set<HazardKind>([
  "unmodeled_kind",
  "unmodeled_drift",
  "unresolved_security_label",
]);

export interface ActionHazard {
  actionIndex: number;
  kinds: HazardKind[];
}

export interface HazardReport {
  /** Actions that have at least one per-action hazard, in action-index order. */
  actions: ActionHazard[];
  /** Coverage-diagnostic kinds present (unique, HAZARD_KIND_ORDER). */
  coverage: HazardKind[];
  /** Unique union of all kinds in this report, HAZARD_KIND_ORDER. */
  kinds: HazardKind[];
}

function sortKinds(kinds: Iterable<HazardKind>): HazardKind[] {
  const unique = new Set(kinds);
  return HAZARD_KIND_ORDER.filter((kind) => unique.has(kind));
}

export function actionHazards(
  action: Pick<
    Action,
    "dataLoss" | "rewriteRisk" | "transactionality" | "lockClass"
  >,
): HazardKind[] {
  const kinds: HazardKind[] = [];
  if (action.dataLoss === "destructive") kinds.push("data_loss");
  if (action.rewriteRisk === true) kinds.push("rewrite_risk");
  if (action.transactionality === "nonTransactional") {
    kinds.push("non_transactional");
  }
  if (action.lockClass === "accessExclusive") {
    kinds.push("access_exclusive_lock");
  }
  return kinds;
}

export function classifyPlanHazards(
  plan: Pick<Plan, "actions">,
  diagnostics?: readonly Diagnostic[],
): HazardReport {
  const actions: ActionHazard[] = [];
  for (const [actionIndex, next] of plan.actions.entries()) {
    const kinds = actionHazards(next);
    if (kinds.length > 0) actions.push({ actionIndex, kinds });
  }

  const coverageSet = new Set<HazardKind>();
  for (const diagnostic of diagnostics ?? []) {
    if (COVERAGE_KINDS.has(diagnostic.code as HazardKind)) {
      coverageSet.add(diagnostic.code as HazardKind);
    }
  }
  const coverage = sortKinds(coverageSet);

  return {
    actions,
    coverage,
    kinds: sortKinds([...actions.flatMap((entry) => entry.kinds), ...coverage]),
  };
}
