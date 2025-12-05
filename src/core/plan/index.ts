/**
 * Plan module - create and organize migration plans.
 *
 * @example
 * ```ts
 * import { createPlan, groupChangesHierarchically } from "./plan";
 *
 * const plan = await createPlan(fromUrl, toUrl);
 * if (plan) {
 *   const hierarchy = groupChangesHierarchically(ctx, changes);
 *   console.log(plan.sql);
 * }
 * ```
 */

// Fingerprinting helpers
export {
  buildPlanScopeFingerprint,
  hashStableIds,
  sha256,
} from "../fingerprint.ts";
// Plan application
export { applyPlan } from "./apply.ts";
// Plan creation
export { buildPlanForCatalogs, createPlan } from "./create.ts";
// Hierarchical grouping
export { groupChangesHierarchically } from "./hierarchy.ts";
// Plan I/O
export { deserializePlan, serializePlan } from "./io.ts";
// Types
export type {
  ChangeEntry,
  ChangeGroup,
  ChangeScope,
  ChildObjectType,
  ClusterGroup,
  ClusterObjectType,
  CreatePlanOptions,
  HierarchicalPlan,
  MaterializedViewChildren,
  ObjectType,
  ParentType,
  Plan,
  PlanStats,
  SchemaGroup,
  TableChildren,
  TypeGroup,
} from "./types.ts";
