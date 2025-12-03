/**
 * Hierarchical grouping of changes for tree display.
 */

import type { Change } from "../change.types.ts";
import type { DiffContext } from "../context.ts";
import type { Integration } from "../integrations/integration.types.ts";
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
function addToChangeGroup(group: ChangeGroup, change: SerializedChange): void {
  group[change.operation].push(change);
}

/**
 * Check if a Change is a column operation (ADD/DROP/ALTER COLUMN).
 */
function isColumnOperation(change: Change): string | null {
  if (change.objectType !== "table") {
    return null;
  }

  const obj = change as unknown as Record<string, unknown>;
  if (
    "column" in obj &&
    typeof obj.column === "object" &&
    obj.column !== null
  ) {
    const col = obj.column as Record<string, unknown>;
    if ("name" in col && typeof col.name === "string") {
      return col.name;
    }
  }

  return null;
}

/**
 * Check if a Change creates a partition table.
 * Returns the parent table name if it's a partition, null otherwise.
 */
function isPartitionTable(change: Change): string | null {
  if (change.objectType !== "table") {
    return null;
  }

  const obj = change as unknown as Record<string, unknown>;
  if ("table" in obj && typeof obj.table === "object" && obj.table !== null) {
    const table = obj.table as Record<string, unknown>;
    if (
      "parent_name" in table &&
      typeof table.parent_name === "string" &&
      table.parent_name
    ) {
      return table.parent_name;
    }
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
    const partitionOf = isPartitionTable(change);

    if (!serialized.schema) {
      addClusterChange(result.cluster, serialized);
      continue;
    }

    if (!result.schemas[serialized.schema]) {
      result.schemas[serialized.schema] = emptySchemaGroup();
    }
    const schemaGroup = result.schemas[serialized.schema];

    if (serialized.parent) {
      addChildChange(schemaGroup, serialized);
      continue;
    }

    addSchemaLevelChange(schemaGroup, serialized, { columnName, partitionOf });
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
  change: SerializedChange,
): void {
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
function addChildChange(schema: SchemaGroup, change: SerializedChange): void {
  if (!change.parent) return;

  const parentName = change.parent.name;
  const parentType = change.parent.type;

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

  const objectType = change.objectType;

  switch (objectType) {
    case "index":
      addToChangeGroup(parent.indexes, change);
      break;
    case "trigger":
      if ("triggers" in parent) {
        addToChangeGroup(parent.triggers, change);
      }
      break;
    case "rule":
      if ("rules" in parent) {
        addToChangeGroup(parent.rules, change);
      }
      break;
    case "rls_policy":
      if ("policies" in parent) {
        addToChangeGroup(parent.policies, change);
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
  change: SerializedChange,
  enrichment: ChangeEnrichment,
): void {
  const objectType = change.objectType;

  switch (objectType) {
    case "schema":
      addToChangeGroup(schema.changes, change);
      break;
    case "table": {
      if (enrichment.columnName) {
        const tableName = change.name;
        if (!schema.tables[tableName]) {
          schema.tables[tableName] = emptyTableChildren();
        }
        addToChangeGroup(schema.tables[tableName].columns, change);
        break;
      }

      if (enrichment.partitionOf) {
        const parentName = enrichment.partitionOf;
        if (!schema.tables[parentName]) {
          schema.tables[parentName] = emptyTableChildren();
        }
        const partitionName = change.name;
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

      const tableName = change.name;
      if (!schema.tables[tableName]) {
        schema.tables[tableName] = emptyTableChildren();
      }
      addToChangeGroup(schema.tables[tableName].changes, change);
      break;
    }
    case "view": {
      const viewName = change.name;
      if (!schema.views[viewName]) {
        schema.views[viewName] = emptyTableChildren();
      }
      addToChangeGroup(schema.views[viewName].changes, change);
      break;
    }
    case "materialized_view": {
      const matviewName = change.name;
      if (!schema.materializedViews[matviewName]) {
        schema.materializedViews[matviewName] = emptyMaterializedViewChildren();
      }
      addToChangeGroup(schema.materializedViews[matviewName].changes, change);
      break;
    }
    case "foreign_table": {
      const ftName = change.name;
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
