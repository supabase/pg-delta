/**
 * Type definitions for the Plan module.
 */

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
 * A serializable representation of a Change for display and storage.
 * This is intentionally minimal - enrichment happens in grouping functions.
 */
export interface SerializedChange {
  /** The operation type */
  operation: "create" | "alter" | "drop";
  /** The type of database object */
  objectType: ObjectType;
  /** The scope of the change - what aspect is being changed */
  scope: ChangeScope;
  /** The object name (without schema) */
  name: string;
  /** Schema name for schema-scoped objects, undefined for cluster-wide */
  schema?: string;
  /** Parent object for child objects (indexes, triggers, policies, etc.) */
  parent?: {
    type: ParentType;
    name: string;
  };
  /** The SQL statement for this change */
  sql: string;
}

/**
 * Flat structure for organizing changes by object type.
 */
export type ChangesByObjectType = Record<string, SerializedChange[]>;

/**
 * Flat structure for organizing changes by operation.
 */
export interface ChangesByOperation {
  create: SerializedChange[];
  alter: SerializedChange[];
  drop: SerializedChange[];
}

// ============================================================================
// Hierarchical Types
// ============================================================================

/**
 * A group of changes organized by operation.
 */
export interface ChangeGroup {
  create: SerializedChange[];
  alter: SerializedChange[];
  drop: SerializedChange[];
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
export interface PlanStats {
  total: number;
  creates: number;
  alters: number;
  drops: number;
  byObjectType: Record<string, number>;
}

/**
 * A migration plan containing all changes to transform one database schema into another.
 */
export interface Plan {
  /** All changes in execution order */
  changes: SerializedChange[];
  /** The complete migration SQL script */
  sql: string;
  /** Statistics about the changes */
  stats: PlanStats;
}

/**
 * Options for creating a plan.
 */
export interface CreatePlanOptions {
  /** Integration for filtering and serialization (defaults to base) */
  integration?: Integration;
}

// Re-import Integration type for CreatePlanOptions
import type { Integration } from "../integrations/integration.types.ts";
