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
import { getObjectSchema, getParentInfo } from "./serialize.ts";
import type {
  ChangeGroup,
  ClusterGroup,
  HierarchicalPlan,
  MaterializedViewChildren,
  SchemaGroup,
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
function addToChangeGroup(group: ChangeGroup, change: Change): void {
  group[change.operation].push({ original: change });
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
  if (branchTable?.is_partition && branchTable.parent_name) {
    return branchTable.parent_name;
  }

  // Also check mainCatalog (source state)
  const mainTable = ctx.mainCatalog.tables[tableKey];
  if (mainTable?.is_partition && mainTable.parent_name) {
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
  _integration: Integration,
): HierarchicalPlan {
  const result: HierarchicalPlan = {
    cluster: emptyClusterGroup(),
    schemas: {},
  };

  for (const change of changes) {
    const columnName = isColumnOperation(change);
    // Check for partitions: either creating a new partition (CreateTable) or any change on an existing partition
    let partitionOf: string | null = null;
    const changeSchema = getObjectSchema(change);
    if (change.objectType === "table" && changeSchema) {
      // First check if this is a CreateTable creating a partition
      partitionOf = isPartitionTable(change);
      // If not, check if this table is an existing partition (for any table change including privilege changes)
      if (!partitionOf) {
        partitionOf = isExistingPartition(ctx, changeSchema, change.table.name);
      }
    }

    if (!changeSchema) {
      addClusterChange(result.cluster, change);
      continue;
    }

    if (!result.schemas[changeSchema]) {
      result.schemas[changeSchema] = emptySchemaGroup();
    }
    const schemaGroup = result.schemas[changeSchema];

    const parent = getParentInfo(change);
    if (parent) {
      addChildChange(schemaGroup, change);
      continue;
    }

    addSchemaLevelChange(schemaGroup, change, {
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
function addClusterChange(cluster: ClusterGroup, change: Change): void {
  const objectType = change.objectType;

  switch (objectType) {
    case "role":
      addToChangeGroup(cluster.roles, change);
      break;
    case "extension":
      addToChangeGroup(cluster.extensions, change);
      break;
    case "event_trigger":
      addToChangeGroup(cluster.eventTriggers, change);
      break;
    case "language":
      // Languages are cluster-wide, but we don't have a group for them yet
      break;
    case "publication":
      addToChangeGroup(cluster.publications, change);
      break;
    case "subscription":
      addToChangeGroup(cluster.subscriptions, change);
      break;
    case "foreign_data_wrapper":
      addToChangeGroup(cluster.foreignDataWrappers, change);
      break;
    case "server":
      addToChangeGroup(cluster.servers, change);
      break;
    case "user_mapping":
      addToChangeGroup(cluster.userMappings, change);
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
function addChildChange(schema: SchemaGroup, change: Change): void {
  const parentInfo = getParentInfo(change);
  if (!parentInfo) return;

  const parentName = parentInfo.name;
  const parentType = parentInfo.type;

  let parentGroup: TableChildren | MaterializedViewChildren;

  switch (parentType) {
    case "table":
      if (!schema.tables[parentName]) {
        schema.tables[parentName] = emptyTableChildren();
      }
      parentGroup = schema.tables[parentName];
      break;
    case "view":
      if (!schema.views[parentName]) {
        schema.views[parentName] = emptyTableChildren();
      }
      parentGroup = schema.views[parentName];
      break;
    case "materialized_view":
      if (!schema.materializedViews[parentName]) {
        schema.materializedViews[parentName] = emptyMaterializedViewChildren();
      }
      parentGroup = schema.materializedViews[parentName];
      break;
    case "foreign_table":
      if (!schema.foreignTables[parentName]) {
        schema.foreignTables[parentName] = emptyTableChildren();
      }
      parentGroup = schema.foreignTables[parentName];
      break;
    default: {
      const _exhaustive: never = parentType;
      throw new Error(`Unhandled parent type: ${_exhaustive}`);
    }
  }

  const objectType = change.objectType;

  switch (objectType) {
    case "index":
      addToChangeGroup(parentGroup.indexes, change);
      break;
    case "trigger":
      if ("triggers" in parentGroup) {
        addToChangeGroup(parentGroup.triggers, change);
      }
      break;
    case "rule":
      if ("rules" in parentGroup) {
        addToChangeGroup(parentGroup.rules, change);
      }
      break;
    case "rls_policy":
      if ("policies" in parentGroup) {
        addToChangeGroup(parentGroup.policies, change);
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
  change: Change,
  enrichment: ChangeEnrichment,
): void {
  const objectType = change.objectType;

  switch (objectType) {
    case "schema":
      addToChangeGroup(schema.changes, change);
      break;
    case "table": {
      // Verify the original change is actually a table change
      // (safeguard against materialized views or other objects being incorrectly routed here)
      if (change.objectType !== "table") {
        // This shouldn't happen, but if it does, skip this change
        // It will be handled by its correct objectType case
        break;
      }

      if (enrichment.columnName) {
        const tableName = change.table.name;
        if (!schema.tables[tableName]) {
          schema.tables[tableName] = emptyTableChildren();
        }
        addToChangeGroup(schema.tables[tableName].columns, change);
        break;
      }

      if (enrichment.partitionOf) {
        // For CreateTable changes, verify it's actually a partition
        if (change instanceof CreateTable) {
          // Additional verification: ensure the table is actually marked as a partition
          if (!change.table.is_partition || !change.table.parent_name) {
            // Table has parent_name but is_partition is false (inheritance, not partitioning)
            // Treat as regular table change
            const tableName = change.table.name;
            if (!schema.tables[tableName]) {
              schema.tables[tableName] = emptyTableChildren();
            }
            addToChangeGroup(schema.tables[tableName].changes, change);
            break;
          }
        }
        // For AlterTable changes on existing partitions, enrichment.partitionOf comes from catalog lookup
        // which is already verified, so we can trust it

        const parentName = enrichment.partitionOf;
        if (!schema.tables[parentName]) {
          schema.tables[parentName] = emptyTableChildren();
        }
        const partitionName = change.table.name;
        if (!schema.tables[parentName].partitions[partitionName]) {
          schema.tables[parentName].partitions[partitionName] =
            emptyTableChildren();
        }
        addToChangeGroup(
          schema.tables[parentName].partitions[partitionName].changes,
          change,
        );
        break;
      }

      const tableName = change.table.name;
      if (!schema.tables[tableName]) {
        schema.tables[tableName] = emptyTableChildren();
      }
      addToChangeGroup(schema.tables[tableName].changes, change);
      break;
    }
    case "view": {
      const viewName = change.view.name;
      if (!schema.views[viewName]) {
        schema.views[viewName] = emptyTableChildren();
      }
      addToChangeGroup(schema.views[viewName].changes, change);
      break;
    }
    case "materialized_view": {
      const matviewName = change.materializedView.name;
      if (!schema.materializedViews[matviewName]) {
        schema.materializedViews[matviewName] = emptyMaterializedViewChildren();
      }
      addToChangeGroup(schema.materializedViews[matviewName].changes, change);
      break;
    }
    case "foreign_table": {
      const ftName = change.foreignTable.name;
      if (!schema.foreignTables[ftName]) {
        schema.foreignTables[ftName] = emptyTableChildren();
      }
      addToChangeGroup(schema.foreignTables[ftName].changes, change);
      break;
    }
    case "procedure":
      addToChangeGroup(schema.functions, change);
      break;
    case "aggregate":
      addToChangeGroup(schema.aggregates, change);
      break;
    case "sequence":
      addToChangeGroup(schema.sequences, change);
      break;
    case "enum":
      addToChangeGroup(schema.types.enums, change);
      break;
    case "composite_type":
      addToChangeGroup(schema.types.composites, change);
      break;
    case "range":
      addToChangeGroup(schema.types.ranges, change);
      break;
    case "domain":
      addToChangeGroup(schema.types.domains, change);
      break;
    case "collation":
      addToChangeGroup(schema.collations, change);
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
