/**
 * Re-export the public plan renderer under the historical CLI names so existing
 * CLI imports (`./render.ts`) keep working. New callers should prefer
 * `renderPlanFiles` from `@supabase/pg-delta/frontends`.
 */
export {
  renderPlanFiles as renderPlan,
  isDestructiveAction,
} from "../frontends/render-plan-files.ts";
