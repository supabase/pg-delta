/**
 * Hierarchical grouping of changes for tree display.
 */

import type { Change } from "../change.types.ts";
import type { DiffContext } from "../context.ts";
import type { Integration } from "../integrations/integration.types.ts";
import {
  AlterTableAddColumn,
  AlterTableAlterColumnDropDefault,
  AlterTableAlterColumnDropNotNull,
  AlterTableAlterColumnSetDefault,
  AlterTableAlterColumnSetNotNull,
  AlterTableAlterColumnType,
  AlterTableDropColumn,
} from "../objects/table/changes/table.alter.ts";
import { CreateTable } from "../objects/table/changes/table.create.ts";
import { serializeChange } from "./serialize.ts";
import type {
  ChangeGroup,
  ClusterGroup,
  HierarchicalPlan,
  MaterializedViewChildren,
  SchemaGroup,
  SerializedChange,
  TableChildren,
  TypeGroup,
} from "./types.ts";

// ============================================================================
// Empty Structure Factories
// ============================================================================

/**
 * Create an empty ChangeGroup.
 */
function emptyChangeGroup(): ChangeGroup {
  return { create: [], alter: [], drop: [] };
}

/**
 * Create an empty TableChildren structure.
 */
function emptyTableChildren(): TableChildren {
  return {
    changes: emptyChangeGroup(),
    columns: emptyChangeGroup(),
    indexes: emptyChangeGroup(),
    triggers: emptyChangeGroup(),
    rules: emptyChangeGroup(),
    policies: emptyChangeGroup(),
    partitions: {},
  };
}

/**
 * Create an empty MaterializedViewChildren structure.
 */
function emptyMaterializedViewChildren(): MaterializedViewChildren {
  return {
    changes: emptyChangeGroup(),
    indexes: emptyChangeGroup(),
  };
}

/**
 * Create an empty TypeGroup structure.
 */
function emptyTypeGroup(): TypeGroup {
  return {
    enums: emptyChangeGroup(),
    composites: emptyChangeGroup(),
    ranges: emptyChangeGroup(),
    domains: emptyChangeGroup(),
  };
}

/**
 * Create an empty SchemaGroup structure.
 */
function emptySchemaGroup(): SchemaGroup {
  return {
    changes: emptyChangeGroup(),
    tables: {},
    views: {},
    materializedViews: {},
    functions: emptyChangeGroup(),
    procedures: emptyChangeGroup(),
    aggregates: emptyChangeGroup(),
    sequences: emptyChangeGroup(),
    types: emptyTypeGroup(),
    collations: emptyChangeGroup(),
    foreignTables: {},
  };
}

/**
 * Create an empty ClusterGroup structure.
 */
function emptyClusterGroup(): ClusterGroup {
  return {
    roles: emptyChangeGroup(),
    extensions: emptyChangeGroup(),
    eventTriggers: emptyChangeGroup(),
    publications: emptyChangeGroup(),
    subscriptions: emptyChangeGroup(),
    foreignDataWrappers: emptyChangeGroup(),
    servers: emptyChangeGroup(),
    userMappings: emptyChangeGroup(),
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Add a change to a ChangeGroup based on its operation.
 */
function addToChangeGroup(
  group: ChangeGroup,
  serialized: SerializedChange,
  original: Change,
): void {
  group[serialized.operation].push({ serialized, original });
}

/**
 * Check if a Change is a column operation (ADD/DROP/ALTER COLUMN).
 * Uses instanceof checks for type safety.
 */
function isColumnOperation(change: Change): string | null {
  if (change.objectType !== "table") {
    return null;
  }

  if (
    change instanceof AlterTableAddColumn ||
    change instanceof AlterTableDropColumn ||
    change instanceof AlterTableAlterColumnType ||
    change instanceof AlterTableAlterColumnSetDefault ||
    change instanceof AlterTableAlterColumnDropDefault ||
    change instanceof AlterTableAlterColumnSetNotNull ||
    change instanceof AlterTableAlterColumnDropNotNull
  ) {
    return change.column.name;
  }

  return null;
}

/**
 * Check if a Change creates a partition table.
 * Returns the parent table name if it's a partition, null otherwise.
 * Uses instanceof checks for type safety.
 *
 * IMPORTANT: This function should ONLY be called for table changes.
 * Materialized views and other object types should never reach this function.
 */
function isPartitionTable(change: Change): string | null {
  // First check: must be a table change
  if (change.objectType !== "table") {
    return null;
  }

  // Second check: must be a CreateTable change (only CreateTable can create partitions)
  // Use instanceof to safely verify the change type
  if (!(change instanceof CreateTable)) {
    return null;
  }

  // Third check: verify the table is actually marked as a partition
  // Both is_partition flag AND parent_name must be set
  if (!change.table.is_partition || !change.table.parent_name) {
    return null;
  }

  return change.table.parent_name;
}

/**
 * Check if a table name (from an AlterTable change) is an existing partition.
 * Checks both mainCatalog and branchCatalog to see if the table is a partition.
 * Returns the parent table name if found, null otherwise.
 */
function isExistingPartition(
  ctx: DiffContext,
  schemaName: string,
  tableName: string,
): string | null {
  const tableKey = `${schemaName}.${tableName}`;

  // Check branchCatalog first (target state - where partitions should be)
  const branchTable = ctx.branchCatalog.tables[tableKey];
  if (branchTable && branchTable.is_partition && branchTable.parent_name) {
    console.error(
      `[isExistingPartition] Found partition in branchCatalog: ${tableName} -> ${branchTable.parent_name}`,
    );
    return branchTable.parent_name;
  }

  // Also check mainCatalog (source state)
  const mainTable = ctx.mainCatalog.tables[tableKey];
  if (mainTable && mainTable.is_partition && mainTable.parent_name) {
    console.error(
      `[isExistingPartition] Found partition in mainCatalog: ${tableName} -> ${mainTable.parent_name}`,
    );
    return mainTable.parent_name;
  }

  return null;
}

// ============================================================================
// Main Grouping Function
// ============================================================================

/**
 * Group changes into a hierarchical structure for tree display.
 *
 * This function takes original Change objects (not SerializedChange) to enable
 * detection of column operations, partitions, and other type-specific details.
 *
 * Organizes changes by:
 * 1. Cluster-wide vs schema-scoped
 * 2. Schema > Object Type > Object Name
 * 3. Parent > Child (e.g., Table > Index, Table > Column)
 * 4. Partitioned Table > Partition
 */
export function groupChangesHierarchically(
  ctx: DiffContext,
  changes: Change[],
  integration: Integration,
): HierarchicalPlan {
  const result: HierarchicalPlan = {
    cluster: emptyClusterGroup(),
    schemas: {},
  };

  for (const change of changes) {
    const serialized = serializeChange(ctx, change, integration);
    const columnName = isColumnOperation(change);
    // Check for partitions: either creating a new partition (CreateTable) or altering an existing one
    let partitionOf: string | null = null;
    if (serialized.objectType === "table" && serialized.schema) {
      // First check if this is a CreateTable creating a partition
      partitionOf = isPartitionTable(change);
      // If not, check if this table is an existing partition (for AlterTable changes)
      if (!partitionOf) {
        partitionOf = isExistingPartition(
          ctx,
          serialized.schema,
          serialized.name,
        );
        if (partitionOf) {
          console.error(
            `[groupChangesHierarchically] Detected existing partition: ${serialized.name} is partition of ${partitionOf}`,
          );
        }
      }
    }

    if (!serialized.schema) {
      addClusterChange(result.cluster, serialized, change);
      continue;
    }

    if (!result.schemas[serialized.schema]) {
      result.schemas[serialized.schema] = emptySchemaGroup();
    }
    const schemaGroup = result.schemas[serialized.schema];

    if (serialized.parent) {
      addChildChange(schemaGroup, serialized, change);
      continue;
    }

    addSchemaLevelChange(schemaGroup, serialized, change, {
      columnName,
      partitionOf,
    });
  }

  return result;
}

// ============================================================================
// Add Functions (exhaustive on object types)
// ============================================================================

/**
 * Add a change to the cluster group (exhaustive on cluster-wide types).
 */
function addClusterChange(
  cluster: ClusterGroup,
  serialized: SerializedChange,
  original: Change,
): void {
  const objectType = serialized.objectType;

  switch (objectType) {
    case "role":
      addToChangeGroup(cluster.roles, serialized, original);
      break;
    case "extension":
      addToChangeGroup(cluster.extensions, serialized, original);
      break;
    case "event_trigger":
      addToChangeGroup(cluster.eventTriggers, serialized, original);
      break;
    case "language":
      // Languages are cluster-wide, but we don't have a group for them yet
      break;
    case "publication":
      addToChangeGroup(cluster.publications, serialized, original);
      break;
    case "subscription":
      addToChangeGroup(cluster.subscriptions, serialized, original);
      break;
    case "foreign_data_wrapper":
      addToChangeGroup(cluster.foreignDataWrappers, serialized, original);
      break;
    case "server":
      addToChangeGroup(cluster.servers, serialized, original);
      break;
    case "user_mapping":
      addToChangeGroup(cluster.userMappings, serialized, original);
      break;
    case "aggregate":
    case "collation":
    case "composite_type":
    case "domain":
    case "enum":
    case "foreign_table":
    case "index":
    case "materialized_view":
    case "procedure":
    case "range":
    case "rls_policy":
    case "rule":
    case "schema":
    case "sequence":
    case "table":
    case "trigger":
    case "view":
      // These have schemas and shouldn't be added to cluster group
      break;
    default: {
      const _exhaustive: never = objectType;
      throw new Error(`Unhandled object type: ${_exhaustive}`);
    }
  }
}

/**
 * Add a child change (index, trigger, policy, rule) to its parent (exhaustive).
 */
function addChildChange(
  schema: SchemaGroup,
  serialized: SerializedChange,
  original: Change,
): void {
  if (!serialized.parent) return;

  const parentName = serialized.parent.name;
  const parentType = serialized.parent.type;

  let parent: TableChildren | MaterializedViewChildren;

  switch (parentType) {
    case "table":
      if (!schema.tables[parentName]) {
        schema.tables[parentName] = emptyTableChildren();
      }
      parent = schema.tables[parentName];
      break;
    case "view":
      if (!schema.views[parentName]) {
        schema.views[parentName] = emptyTableChildren();
      }
      parent = schema.views[parentName];
      break;
    case "materialized_view":
      if (!schema.materializedViews[parentName]) {
        schema.materializedViews[parentName] = emptyMaterializedViewChildren();
      }
      parent = schema.materializedViews[parentName];
      break;
    case "foreign_table":
      if (!schema.foreignTables[parentName]) {
        schema.foreignTables[parentName] = emptyTableChildren();
      }
      parent = schema.foreignTables[parentName];
      break;
    default: {
      const _exhaustive: never = parentType;
      throw new Error(`Unhandled parent type: ${_exhaustive}`);
    }
  }

  const objectType = serialized.objectType;

  switch (objectType) {
    case "index":
      addToChangeGroup(parent.indexes, serialized, original);
      break;
    case "trigger":
      if ("triggers" in parent) {
        addToChangeGroup(parent.triggers, serialized, original);
      }
      break;
    case "rule":
      if ("rules" in parent) {
        addToChangeGroup(parent.rules, serialized, original);
      }
      break;
    case "rls_policy":
      if ("policies" in parent) {
        addToChangeGroup(parent.policies, serialized, original);
      }
      break;
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
      break;
    default: {
      const _exhaustive: never = objectType;
      throw new Error(`Unhandled object type: ${_exhaustive}`);
    }
  }
}

/**
 * Enrichment info detected from original Change objects.
 */
interface ChangeEnrichment {
  columnName: string | null;
  partitionOf: string | null;
}

/**
 * Add a schema-level change to the appropriate group (exhaustive).
 */
function addSchemaLevelChange(
  schema: SchemaGroup,
  serialized: SerializedChange,
  original: Change,
  enrichment: ChangeEnrichment,
): void {
  // Critical safeguard: ensure serialized objectType matches original change objectType
  // This prevents materialized views or other objects from being incorrectly routed
  if (serialized.objectType !== original.objectType) {
    // This indicates a bug in serialization - skip this change to prevent incorrect routing
    // The change will be lost, but this prevents materialized views from appearing as partitions
    return;
  }

  const objectType = serialized.objectType;

  switch (objectType) {
    case "schema":
      addToChangeGroup(schema.changes, serialized, original);
      break;
    case "table": {
      // Verify the original change is actually a table change
      // (safeguard against materialized views or other objects being incorrectly routed here)
      if (original.objectType !== "table") {
        // This shouldn't happen, but if it does, skip this change
        // It will be handled by its correct objectType case
        break;
      }

      if (enrichment.columnName) {
        const tableName = serialized.name;
        if (!schema.tables[tableName]) {
          schema.tables[tableName] = emptyTableChildren();
        }
        addToChangeGroup(
          schema.tables[tableName].columns,
          serialized,
          original,
        );
        break;
      }

      if (enrichment.partitionOf) {
        // For CreateTable changes, verify it's actually a partition
        if (original instanceof CreateTable) {
          // Additional verification: ensure the table is actually marked as a partition
          if (!original.table.is_partition || !original.table.parent_name) {
            // Table has parent_name but is_partition is false (inheritance, not partitioning)
            // Treat as regular table change
            const tableName = serialized.name;
            if (!schema.tables[tableName]) {
              schema.tables[tableName] = emptyTableChildren();
            }
            addToChangeGroup(
              schema.tables[tableName].changes,
              serialized,
              original,
            );
            break;
          }
        }
        // For AlterTable changes on existing partitions, enrichment.partitionOf comes from catalog lookup
        // which is already verified, so we can trust it

        const parentName = enrichment.partitionOf;
        console.error(
          `[addSchemaLevelChange] Routing ${serialized.name} as partition of ${parentName}`,
        );
        if (!schema.tables[parentName]) {
          schema.tables[parentName] = emptyTableChildren();
        }
        const partitionName = serialized.name;
        if (!schema.tables[parentName].partitions[partitionName]) {
          schema.tables[parentName].partitions[partitionName] =
            emptyTableChildren();
        }
        addToChangeGroup(
          schema.tables[parentName].partitions[partitionName].changes,
          serialized,
          original,
        );
        break;
      }

      const tableName = serialized.name;
      if (!schema.tables[tableName]) {
        schema.tables[tableName] = emptyTableChildren();
      }
      addToChangeGroup(schema.tables[tableName].changes, serialized, original);
      break;
    }
    case "view": {
      const viewName = serialized.name;
      if (!schema.views[viewName]) {
        schema.views[viewName] = emptyTableChildren();
      }
      addToChangeGroup(schema.views[viewName].changes, serialized, original);
      break;
    }
    case "materialized_view": {
      const matviewName = serialized.name;
      if (!schema.materializedViews[matviewName]) {
        schema.materializedViews[matviewName] = emptyMaterializedViewChildren();
      }
      addToChangeGroup(
        schema.materializedViews[matviewName].changes,
        serialized,
        original,
      );
      break;
    }
    case "foreign_table": {
      const ftName = serialized.name;
      if (!schema.foreignTables[ftName]) {
        schema.foreignTables[ftName] = emptyTableChildren();
      }
      addToChangeGroup(
        schema.foreignTables[ftName].changes,
        serialized,
        original,
      );
      break;
    }
    case "procedure":
      addToChangeGroup(schema.functions, serialized, original);
      break;
    case "aggregate":
      addToChangeGroup(schema.aggregates, serialized, original);
      break;
    case "sequence":
      addToChangeGroup(schema.sequences, serialized, original);
      break;
    case "enum":
      addToChangeGroup(schema.types.enums, serialized, original);
      break;
    case "composite_type":
      addToChangeGroup(schema.types.composites, serialized, original);
      break;
    case "range":
      addToChangeGroup(schema.types.ranges, serialized, original);
      break;
    case "domain":
      addToChangeGroup(schema.types.domains, serialized, original);
      break;
    case "collation":
      addToChangeGroup(schema.collations, serialized, original);
      break;
    case "extension":
      break;
    case "index":
    case "trigger":
    case "rule":
    case "rls_policy":
      break;
    case "event_trigger":
    case "foreign_data_wrapper":
    case "language":
    case "publication":
    case "role":
    case "server":
    case "subscription":
    case "user_mapping":
      break;
    default: {
      const _exhaustive: never = objectType;
      throw new Error(`Unhandled object type: ${_exhaustive}`);
    }
  }
}
