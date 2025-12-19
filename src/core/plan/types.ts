/**
 * Type definitions for the Plan module.
 */

import z from "zod";
import type { Change } from "../change.types.ts";
import type { FilterDSL } from "../integrations/filter/dsl.ts";
import type { SerializeDSL } from "../integrations/serialize/dsl.ts";
import type { ChangeFilter, ChangeSerializer } from "../main.ts";

// ============================================================================
// Core Types
// ============================================================================

export type PlanRisk =
  | { level: "safe" }
  | { level: "data_loss"; statements: string[] };

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
 * Plan schema for serialization/deserialization.
 */
export const PlanSchema = z.object({
  version: z.number(),
  toolVersion: z.string().optional(),
  source: z.object({
    fingerprint: z.string(),
  }),
  target: z.object({
    fingerprint: z.string(),
  }),
  statements: z.array(z.string()),
  role: z.string().optional(),
  filter: z.any().optional(), // FilterDSL - complex recursive type, validated at compile time
  serialize: z.any().optional(), // SerializeDSL - complex recursive type, validated at compile time
  risk: z
    .discriminatedUnion("level", [
      z.object({
        level: z.literal("safe"),
      }),
      z.object({
        level: z.literal("data_loss"),
        statements: z.array(z.string()),
      }),
    ])
    .optional(),
});

/**
 * A migration plan containing all changes to transform one database schema into another.
 */
export type Plan = z.infer<typeof PlanSchema>;

/**
 * Options for creating a plan.
 */
export interface CreatePlanOptions {
  /** Filter - either FilterDSL (stored in plan) or ChangeFilter function (not stored) */
  filter?: FilterDSL | ChangeFilter;
  /** Serialize - either SerializeDSL (stored in plan) or ChangeSerializer function (not stored) */
  serialize?: SerializeDSL | ChangeSerializer;
  /** Role to use when executing the migration (SET ROLE will be added to statements) */
  role?: string;
}
