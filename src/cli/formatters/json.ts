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
      stats: plan.stats,
      changes: plan.changes,
      hierarchy,
      sql: plan.sql,
    },
    null,
    2,
  );
}
