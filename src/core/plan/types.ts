/**
 * Type definitions for the Plan module.
 */

import z from "zod";
import type { Change } from "../change.types.ts";

// ============================================================================
// Core Types
// ============================================================================

/**
 * All supported object types in the system.
 * Derived from the Change union type's objectType discriminant.
 */
export type ObjectType = Change["objectType"];

/**
 * Cluster-wide object types (no schema).
 */
export type ClusterObjectType = Extract<
  ObjectType,
  | "event_trigger"
  | "foreign_data_wrapper"
  | "language"
  | "publication"
  | "role"
  | "server"
  | "subscription"
  | "user_mapping"
>;

/**
 * Object types that are children of tables/views.
 */
export type ChildObjectType = Extract<
  ObjectType,
  "index" | "trigger" | "rule" | "rls_policy"
>;

/**
 * Parent types for child objects.
 */
export type ParentType = Extract<
  ObjectType,
  "table" | "view" | "materialized_view" | "foreign_table"
>;

/**
 * Change scopes - what aspect of an object is being changed.
 * Derived from the Change union type's scope property.
 */
export type ChangeScope = Change["scope"];

/**
 * A change entry storing both serialized and original change for instanceof checks.
 */
export interface ChangeEntry {
  original: Change;
}

/**
 * A group of changes organized by operation.
 */
export interface ChangeGroup {
  create: ChangeEntry[];
  alter: ChangeEntry[];
  drop: ChangeEntry[];
}

/**
 * Children objects of a table/view (indexes, triggers, policies, etc.)
 */
export interface TableChildren {
  changes: ChangeGroup;
  columns: ChangeGroup;
  indexes: ChangeGroup;
  triggers: ChangeGroup;
  rules: ChangeGroup;
  policies: ChangeGroup;
  /** Partition tables (only for partitioned tables) */
  partitions: Record<string, TableChildren>;
}

/**
 * Children objects of a materialized view
 */
export interface MaterializedViewChildren {
  changes: ChangeGroup;
  indexes: ChangeGroup;
}

/**
 * Type grouping within a schema
 */
export interface TypeGroup {
  enums: ChangeGroup;
  composites: ChangeGroup;
  ranges: ChangeGroup;
  domains: ChangeGroup;
}

/**
 * Schema-level grouping of objects
 */
export interface SchemaGroup {
  changes: ChangeGroup;
  tables: Record<string, TableChildren>;
  views: Record<string, TableChildren>;
  materializedViews: Record<string, MaterializedViewChildren>;
  functions: ChangeGroup;
  procedures: ChangeGroup;
  aggregates: ChangeGroup;
  sequences: ChangeGroup;
  types: TypeGroup;
  collations: ChangeGroup;
  foreignTables: Record<string, TableChildren>;
}

/**
 * Cluster-wide objects (no schema)
 */
export interface ClusterGroup {
  roles: ChangeGroup;
  extensions: ChangeGroup;
  eventTriggers: ChangeGroup;
  publications: ChangeGroup;
  subscriptions: ChangeGroup;
  foreignDataWrappers: ChangeGroup;
  servers: ChangeGroup;
  userMappings: ChangeGroup;
}

/**
 * Fully hierarchical plan structure for tree display.
 */
export interface HierarchicalPlan {
  cluster: ClusterGroup;
  schemas: Record<string, SchemaGroup>;
}

/**
 * Statistics about the changes in a plan.
 */
const PlanStatsSchema = z.object({
  total: z.number(),
  creates: z.number(),
  alters: z.number(),
  drops: z.number(),
  byObjectType: z.record(z.string(), z.number()),
});

export type PlanStats = z.infer<typeof PlanStatsSchema>;

/**
 * Plan schema for serialization/deserialization.
 */
export const PlanSchema = z.object({
  version: z.number(),
  toolVersion: z.string().optional(),
  integration: z
    .object({
      id: z.string(),
      configHash: z.string().optional(),
    })
    .optional(),
  source: z
    .object({
      url: z.string().optional(),
      label: z.string().optional(),
    })
    .optional(),
  target: z
    .object({
      url: z.string().optional(),
      label: z.string().optional(),
    })
    .optional(),
  stableIds: z.array(z.string()),
  fingerprintFrom: z.string(),
  fingerprintTo: z.string().optional(),
  sqlHash: z.string(),
  sql: z.string(),
  stats: PlanStatsSchema,
});

/**
 * A migration plan containing all changes to transform one database schema into another.
 */
export type Plan = z.infer<typeof PlanSchema>;

/**
 * Options for creating a plan.
 */
export interface CreatePlanOptions {
  /** Integration for filtering and serialization (defaults to base) */
  integration?: Integration;
}

// Re-import Integration type for CreatePlanOptions
import type { Integration } from "../integrations/integration.types.ts";
