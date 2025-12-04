/**
 * JSON formatter for displaying plans.
 */

import type { HierarchicalPlan, Plan } from "../../core/plan/index.ts";

/**
 * Format a plan as JSON.
 */
export function formatJson(plan: Plan, hierarchy: HierarchicalPlan): string {
  return JSON.stringify(
    {
      version: plan.version,
      toolVersion: plan.toolVersion,
      integration: plan.integration,
      source: plan.source,
      target: plan.target,
      stableIds: plan.stableIds,
      fingerprintFrom: plan.fingerprintFrom,
      fingerprintTo: plan.fingerprintTo,
      sqlHash: plan.sqlHash,
      stats: plan.stats,
      hierarchy,
      sql: plan.sql,
    },
    null,
    2,
  );
}
