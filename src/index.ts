/**
 * @supabase/pg-delta - PostgreSQL migrations made easy
 *
 * This module exports the public API for the pg-delta library.
 */

export type { IntegrationDSL } from "./core/integrations/integration-dsl.ts";
export { applyPlan } from "./core/plan/apply.ts";
// Core operations
export { createPlan } from "./core/plan/create.ts";
// Types
export type { CreatePlanOptions, Plan } from "./core/plan/types.ts";
