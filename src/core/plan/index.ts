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
 *   const hierarchy = groupChangesHierarchically(ctx, sortedChanges);
 *   console.log(plan.statements);
 * }
 * ```
 */

// Plan creation
export { createPlan } from "./create.ts";
// Hierarchical grouping

// Plan I/O
export { deserializePlan, serializePlan } from "./io.ts";
// Types
export type {
  ChangeEntry,
  ChangeGroup,
  HierarchicalPlan,
  Plan,
} from "./types.ts";
