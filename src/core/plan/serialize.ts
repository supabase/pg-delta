/**
 * Serialization utilities for converting Change objects to SerializedChange.
 */

import type { Change } from "../change.types.ts";
import type { DiffContext } from "../context.ts";
import type { Integration } from "../integrations/integration.types.ts";
import type { ParentType, SerializedChange } from "./types.ts";

// ============================================================================
// Type-safe Change Accessors (with exhaustive checking)
// ============================================================================

/**
 * Parent info for child objects (indexes, triggers, etc.)
 */
type ParentInfo = {
  type: ParentType;
  name: string;
};

/**
 * Extracted information about an object from a change.
 */
interface ObjectInfo {
  name: string;
  schema?: string;
  parent?: ParentInfo;
}

/**
 * Get the object name from a change (exhaustive).
 */
export function getObjectName(change: Change): string {
  switch (change.objectType) {
    case "aggregate":
      return change.aggregate.name;
    case "collation":
      return change.collation.name;
    case "composite_type":
      return change.compositeType.name;
    case "domain":
      return change.domain.name;
    case "enum":
      return change.enum.name;
    case "event_trigger":
      return change.eventTrigger.name;
    case "extension":
      return change.extension.name;
    case "foreign_data_wrapper":
      return change.foreignDataWrapper.name;
    case "foreign_table":
      return change.foreignTable.name;
    case "index":
      return change.index.name;
    case "language":
      return change.language.name;
    case "materialized_view":
      return change.materializedView.name;
    case "procedure":
      return change.procedure.name;
    case "publication":
      return change.publication.name;
    case "range":
      return change.range.name;
    case "rls_policy":
      return change.policy.name;
    case "role":
      return change.role.name;
    case "rule":
      return change.rule.name;
    case "schema":
      return change.schema.name;
    case "sequence":
      return change.sequence.name;
    case "server":
      return change.server.name;
    case "subscription":
      return change.subscription.name;
    case "table":
      return change.table.name;
    case "trigger":
      return change.trigger.name;
    case "user_mapping":
      return `${change.userMapping.user}@${change.userMapping.server}`;
    case "view":
      return change.view.name;
    default: {
      const _exhaustive: never = change;
      return _exhaustive;
    }
  }
}

/**
 * Get the schema from a change, or null for cluster-wide objects (exhaustive).
 */
export function getObjectSchema(change: Change): string | null {
  switch (change.objectType) {
    case "aggregate":
      return change.aggregate.schema;
    case "collation":
      return change.collation.schema;
    case "composite_type":
      return change.compositeType.schema;
    case "domain":
      return change.domain.schema;
    case "enum":
      return change.enum.schema;
    case "event_trigger":
      return null;
    case "extension":
      return change.extension.schema;
    case "foreign_data_wrapper":
      return null;
    case "foreign_table":
      return change.foreignTable.schema;
    case "index":
      return change.index.schema;
    case "language":
      return null;
    case "materialized_view":
      return change.materializedView.schema;
    case "procedure":
      return change.procedure.schema;
    case "publication":
      return null;
    case "range":
      return change.range.schema;
    case "rls_policy":
      return change.policy.schema;
    case "role":
      return null;
    case "rule":
      return change.rule.schema;
    case "schema":
      return change.schema.name;
    case "sequence":
      return change.sequence.schema;
    case "server":
      return null;
    case "subscription":
      return null;
    case "table":
      return change.table.schema;
    case "trigger":
      return change.trigger.schema;
    case "user_mapping":
      return null;
    case "view":
      return change.view.schema;
    default: {
      const _exhaustive: never = change;
      return _exhaustive;
    }
  }
}

/**
 * Get parent info for child objects (indexes, triggers, policies, rules).
 * Returns null for top-level objects (exhaustive).
 */
export function getParentInfo(change: Change): ParentInfo | null {
  switch (change.objectType) {
    case "index":
      return { type: "table", name: change.index.table_name };
    case "trigger":
      return { type: "table", name: change.trigger.table_name };
    case "rule":
      return { type: "table", name: change.rule.table_name };
    case "rls_policy":
      return { type: "table", name: change.policy.table_name };
    case "aggregate":
    case "collation":
    case "composite_type":
    case "domain":
    case "enum":
    case "event_trigger":
    case "extension":
    case "foreign_data_wrapper":
    case "foreign_table":
    case "language":
    case "materialized_view":
    case "procedure":
    case "publication":
    case "range":
    case "role":
    case "schema":
    case "sequence":
    case "server":
    case "subscription":
    case "table":
    case "user_mapping":
    case "view":
      return null;
    default: {
      const _exhaustive: never = change;
      return _exhaustive;
    }
  }
}

/**
 * Extract all object info (name, schema, parent) from a change.
 */
export function extractObjectInfo(change: Change): ObjectInfo {
  const name = getObjectName(change);
  const schema = getObjectSchema(change);
  const parent = getParentInfo(change);

  const result: ObjectInfo = { name };

  if (schema !== null) {
    result.schema = schema;
  }

  if (parent !== null) {
    result.parent = parent;
  }

  return result;
}

/**
 * Serialize a Change to a plain object for display and storage.
 */
export function serializeChange(
  ctx: DiffContext,
  change: Change,
  integration: Integration,
): SerializedChange {
  const sql = integration.serialize?.(ctx, change) ?? change.serialize();
  const info = extractObjectInfo(change);

  const result: SerializedChange = {
    operation: change.operation,
    objectType: change.objectType,
    scope: change.scope,
    name: info.name,
    sql,
  };

  if (info.schema) {
    result.schema = info.schema;
  }
  if (info.parent) {
    result.parent = info.parent;
  }

  return result;
}
