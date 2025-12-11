/**
 * Plan module - create and organize migration plans.
 *
 * @example
 * ```ts
 * import { createPlan, groupChangesHierarchically } from "./plan";
 *
 * const planResult = await createPlan(fromUrl, toUrl);
 * if (planResult) {
 *   const { plan, sortedChanges, ctx } = planResult;
 *   const hierarchy = groupChangesHierarchically(ctx, changes);
 *   console.log(plan.statements);
 * }
 * ```
 */

// Plan creation
export {  createPlan } from "./create.ts";
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
  SchemaGroup,
  TableChildren,
  TypeGroup,
} from "./types.ts";
