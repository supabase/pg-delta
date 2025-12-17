/**
 * @supabase/pg-delta - PostgreSQL migrations made easy
 *
 * This module exports the public API for the pg-delta library.
 */

// =============================================================================
// Plan - Compute schema diff and generate migration plans
// =============================================================================

export type {
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
} from "./plan/index.ts";
export {
  createPlan,
  groupChangesHierarchically,
} from "./plan/index.ts";

// =============================================================================
// Integrations (optional)
// =============================================================================

export type { Integration } from "./integrations/integration.types.ts";

// =============================================================================
// Low-level APIs (for advanced usage)
// =============================================================================

export { diffCatalogs } from "./catalog.diff.ts";
export { Catalog, extractCatalog } from "./catalog.model.ts";
export type { Change } from "./change.types.ts";
export type { DiffContext } from "./context.ts";
export {
  buildPlanScopeFingerprint,
  collectStableIds,
  hashStableIds,
  sha256,
} from "./fingerprint.ts";
export { postgresConfig } from "./postgres-config.ts";
export { sortChanges } from "./sort/sort-changes.ts";
