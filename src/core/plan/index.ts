/**
 * Plan module - create and organize migration plans.
 *
 * @example
 * ```ts
 * import { createPlan, groupChangesHierarchically } from "./plan";
 *
 * const plan = await createPlan(fromUrl, toUrl);
 * if (plan) {
 *   const hierarchy = groupChangesHierarchically(ctx, changes, integration);
 *   console.log(plan.sql);
 * }
 * ```
 */

// Plan creation
export {
  createPlan,
  groupChangesByObjectType,
  groupChangesByOperation,
} from "./create.ts";
// Hierarchical grouping
export { groupChangesHierarchically } from "./hierarchy.ts";

// Serialization
export {
  extractObjectInfo,
  getObjectName,
  getObjectSchema,
  getParentInfo,
  serializeChange,
} from "./serialize.ts";
// Types
export type {
  ChangeEntry,
  ChangeGroup,
  ChangeScope,
  ChangesByObjectType,
  ChangesByOperation,
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
  SerializedChange,
  TableChildren,
  TypeGroup,
} from "./types.ts";
