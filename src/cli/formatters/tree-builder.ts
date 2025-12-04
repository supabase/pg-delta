/**
 * Builds a generic tree structure from a HierarchicalPlan.
 */

import {
  AlterTableAddColumn,
  AlterTableAlterColumnDropDefault,
  AlterTableAlterColumnDropNotNull,
  AlterTableAlterColumnSetDefault,
  AlterTableAlterColumnSetNotNull,
  AlterTableAlterColumnType,
  AlterTableDropColumn,
} from "../../core/objects/table/changes/table.alter.ts";
import type {
  ChangeEntry,
  ChangeGroup,
  HierarchicalPlan,
} from "../../core/plan/index.ts";
import type { TreeGroup, TreeItem } from "./tree-renderer.ts";

/**
 * Filter a ChangeGroup to only include structural changes (scope === "object").
 */
function filterStructuralChanges(group: ChangeGroup): ChangeGroup {
  return {
    create: group.create.filter((entry) => entry.serialized.scope === "object"),
    alter: group.alter.filter((entry) => entry.serialized.scope === "object"),
    drop: group.drop.filter((entry) => entry.serialized.scope === "object"),
  };
}

/**
 * Determines the primary operation symbol for an entity based on its structural changes.
 * Prioritizes create > alter > drop.
 */
function getEntitySymbol(group: ChangeGroup): string {
  const structural = filterStructuralChanges(group);
  if (structural.create.length > 0) return "+";
  if (structural.alter.length > 0) return "~";
  if (structural.drop.length > 0) return "-";
  return ""; // No structural changes
}

/**
 * Get display name for a change entry.
 * Uses instanceof checks to extract column names for column operations.
 */
function getDisplayName(entry: ChangeEntry): string {
  const { serialized, original } = entry;

  // For column operations, extract column name using instanceof
  // Column operations are stored in table.columns but serialized.name is the table name
  // We need to check the original Change object to get the actual column name
  if (
    original instanceof AlterTableAddColumn ||
    original instanceof AlterTableDropColumn ||
    original instanceof AlterTableAlterColumnType ||
    original instanceof AlterTableAlterColumnSetDefault ||
    original instanceof AlterTableAlterColumnDropDefault ||
    original instanceof AlterTableAlterColumnSetNotNull ||
    original instanceof AlterTableAlterColumnDropNotNull
  ) {
    return original.column.name;
  }

  // For all other changes, use the serialized name
  return serialized.name;
}

/**
 * Convert a ChangeGroup to TreeItems.
 */
function changeGroupToItems(group: ChangeGroup): TreeItem[] {
  const items: TreeItem[] = [];
  for (const entry of group.create) {
    items.push({ name: `+ ${getDisplayName(entry)}` });
  }
  for (const entry of group.alter) {
    items.push({ name: `~ ${getDisplayName(entry)}` });
  }
  for (const entry of group.drop) {
    items.push({ name: `- ${getDisplayName(entry)}` });
  }
  return items;
}

/**
 * Build tree structure for table children.
 */
function buildTableChildrenTree(
  table: HierarchicalPlan["schemas"][string]["tables"][string],
): TreeGroup[] {
  const groups: TreeGroup[] = [];

  // Columns
  if (
    table.columns.create.length +
      table.columns.alter.length +
      table.columns.drop.length >
    0
  ) {
    groups.push({
      name: "columns",
      items: changeGroupToItems(table.columns),
    });
  }

  // Indexes
  if (
    table.indexes.create.length +
      table.indexes.alter.length +
      table.indexes.drop.length >
    0
  ) {
    groups.push({
      name: "indexes",
      items: changeGroupToItems(table.indexes),
    });
  }

  // Triggers
  if (
    table.triggers.create.length +
      table.triggers.alter.length +
      table.triggers.drop.length >
    0
  ) {
    groups.push({
      name: "triggers",
      items: changeGroupToItems(table.triggers),
    });
  }

  // Rules
  if (
    table.rules.create.length +
      table.rules.alter.length +
      table.rules.drop.length >
    0
  ) {
    groups.push({
      name: "rules",
      items: changeGroupToItems(table.rules),
    });
  }

  // Policies
  if (
    table.policies.create.length +
      table.policies.alter.length +
      table.policies.drop.length >
    0
  ) {
    groups.push({
      name: "policies",
      items: changeGroupToItems(table.policies),
    });
  }

  // Partitions
  const partitionNames = Object.keys(table.partitions).sort();
  if (partitionNames.length > 0) {
    const partitionGroups: TreeGroup[] = [];
    for (const partitionName of partitionNames) {
      const partition = table.partitions[partitionName];
      const structuralChanges = filterStructuralChanges(partition.changes);
      const symbol = getEntitySymbol(structuralChanges);
      partitionGroups.push({
        name: symbol ? `${symbol} ${partitionName}` : partitionName,
        groups: buildTableChildrenTree(partition),
      });
    }
    groups.push({
      name: "partitions",
      groups: partitionGroups,
    });
  }

  return groups;
}

/**
 * Build tree structure for materialized view children.
 */
function buildMaterializedViewChildrenTree(
  matview: HierarchicalPlan["schemas"][string]["materializedViews"][string],
): TreeGroup[] {
  const groups: TreeGroup[] = [];

  if (
    matview.indexes.create.length +
      matview.indexes.alter.length +
      matview.indexes.drop.length >
    0
  ) {
    groups.push({
      name: "indexes",
      items: changeGroupToItems(matview.indexes),
    });
  }

  return groups;
}

/**
 * Build tree structure for cluster group.
 */
function buildClusterTree(cluster: HierarchicalPlan["cluster"]): TreeGroup[] {
  const groups: TreeGroup[] = [];

  if (
    cluster.roles.create.length +
      cluster.roles.alter.length +
      cluster.roles.drop.length >
    0
  ) {
    groups.push({
      name: "roles",
      items: changeGroupToItems(cluster.roles),
    });
  }

  if (
    cluster.extensions.create.length +
      cluster.extensions.alter.length +
      cluster.extensions.drop.length >
    0
  ) {
    groups.push({
      name: "extensions",
      items: changeGroupToItems(cluster.extensions),
    });
  }

  if (
    cluster.eventTriggers.create.length +
      cluster.eventTriggers.alter.length +
      cluster.eventTriggers.drop.length >
    0
  ) {
    groups.push({
      name: "event-triggers",
      items: changeGroupToItems(cluster.eventTriggers),
    });
  }

  if (
    cluster.publications.create.length +
      cluster.publications.alter.length +
      cluster.publications.drop.length >
    0
  ) {
    groups.push({
      name: "publications",
      items: changeGroupToItems(cluster.publications),
    });
  }

  if (
    cluster.subscriptions.create.length +
      cluster.subscriptions.alter.length +
      cluster.subscriptions.drop.length >
    0
  ) {
    groups.push({
      name: "subscriptions",
      items: changeGroupToItems(cluster.subscriptions),
    });
  }

  if (
    cluster.foreignDataWrappers.create.length +
      cluster.foreignDataWrappers.alter.length +
      cluster.foreignDataWrappers.drop.length >
    0
  ) {
    groups.push({
      name: "foreign-data-wrappers",
      items: changeGroupToItems(cluster.foreignDataWrappers),
    });
  }

  if (
    cluster.servers.create.length +
      cluster.servers.alter.length +
      cluster.servers.drop.length >
    0
  ) {
    groups.push({
      name: "servers",
      items: changeGroupToItems(cluster.servers),
    });
  }

  if (
    cluster.userMappings.create.length +
      cluster.userMappings.alter.length +
      cluster.userMappings.drop.length >
    0
  ) {
    groups.push({
      name: "user-mappings",
      items: changeGroupToItems(cluster.userMappings),
    });
  }

  return groups;
}

/**
 * Build tree structure for schema group.
 */
function buildSchemaTree(
  schema: HierarchicalPlan["schemas"][string],
): TreeGroup[] {
  const groups: TreeGroup[] = [];

  // Tables
  const tableNames = Object.keys(schema.tables).sort();
  if (tableNames.length > 0) {
    const tableGroups: TreeGroup[] = [];
    for (const tableName of tableNames) {
      const table = schema.tables[tableName];
      const structuralChanges = filterStructuralChanges(table.changes);
      const symbol = getEntitySymbol(structuralChanges);
      console.error(`[buildSchemaTree] Table: ${tableName}, symbol: "${symbol}", structural changes: create=${structuralChanges.create.length}, alter=${structuralChanges.alter.length}, drop=${structuralChanges.drop.length}`);
      console.error(`[buildSchemaTree] Table ${tableName} total changes: create=${table.changes.create.length}, alter=${table.changes.alter.length}, drop=${table.changes.drop.length}`);
      tableGroups.push({
        name: symbol ? `${symbol} ${tableName}` : tableName,
        groups: buildTableChildrenTree(table),
      });
    }
    groups.push({
      name: "tables",
      groups: tableGroups,
    });
  }

  // Views
  const viewNames = Object.keys(schema.views).sort();
  if (viewNames.length > 0) {
    const viewGroups: TreeGroup[] = [];
    for (const viewName of viewNames) {
      const view = schema.views[viewName];
      const structuralChanges = filterStructuralChanges(view.changes);
      const symbol = getEntitySymbol(structuralChanges);
      viewGroups.push({
        name: `${symbol} ${viewName}`,
        groups: buildTableChildrenTree(view),
      });
    }
    groups.push({
      name: "views",
      groups: viewGroups,
    });
  }

  // Materialized Views
  const matviewNames = Object.keys(schema.materializedViews).sort();
  if (matviewNames.length > 0) {
    const matviewGroups: TreeGroup[] = [];
    for (const matviewName of matviewNames) {
      const matview = schema.materializedViews[matviewName];
      const structuralChanges = filterStructuralChanges(matview.changes);
      const symbol = getEntitySymbol(structuralChanges);
      matviewGroups.push({
        name: `${symbol} ${matviewName}`,
        groups: buildMaterializedViewChildrenTree(matview),
      });
    }
    groups.push({
      name: "materialized-views",
      groups: matviewGroups,
    });
  }

  // Functions
  if (
    schema.functions.create.length +
      schema.functions.alter.length +
      schema.functions.drop.length >
    0
  ) {
    groups.push({
      name: "functions",
      items: changeGroupToItems(schema.functions),
    });
  }

  // Procedures
  if (
    schema.procedures.create.length +
      schema.procedures.alter.length +
      schema.procedures.drop.length >
    0
  ) {
    groups.push({
      name: "procedures",
      items: changeGroupToItems(schema.procedures),
    });
  }

  // Aggregates
  if (
    schema.aggregates.create.length +
      schema.aggregates.alter.length +
      schema.aggregates.drop.length >
    0
  ) {
    groups.push({
      name: "aggregates",
      items: changeGroupToItems(schema.aggregates),
    });
  }

  // Sequences
  if (
    schema.sequences.create.length +
      schema.sequences.alter.length +
      schema.sequences.drop.length >
    0
  ) {
    groups.push({
      name: "sequences",
      items: changeGroupToItems(schema.sequences),
    });
  }

  // Types
  const hasTypes =
    schema.types.enums.create.length +
      schema.types.enums.alter.length +
      schema.types.enums.drop.length +
      schema.types.composites.create.length +
      schema.types.composites.alter.length +
      schema.types.composites.drop.length +
      schema.types.ranges.create.length +
      schema.types.ranges.alter.length +
      schema.types.ranges.drop.length +
      schema.types.domains.create.length +
      schema.types.domains.alter.length +
      schema.types.domains.drop.length >
    0;

  if (hasTypes) {
    const typeGroups: TreeGroup[] = [];
    if (
      schema.types.enums.create.length +
        schema.types.enums.alter.length +
        schema.types.enums.drop.length >
      0
    ) {
      typeGroups.push({
        name: "enums",
        items: changeGroupToItems(schema.types.enums),
      });
    }
    if (
      schema.types.composites.create.length +
        schema.types.composites.alter.length +
        schema.types.composites.drop.length >
      0
    ) {
      typeGroups.push({
        name: "composite-types",
        items: changeGroupToItems(schema.types.composites),
      });
    }
    if (
      schema.types.ranges.create.length +
        schema.types.ranges.alter.length +
        schema.types.ranges.drop.length >
      0
    ) {
      typeGroups.push({
        name: "ranges",
        items: changeGroupToItems(schema.types.ranges),
      });
    }
    if (
      schema.types.domains.create.length +
        schema.types.domains.alter.length +
        schema.types.domains.drop.length >
      0
    ) {
      typeGroups.push({
        name: "domains",
        items: changeGroupToItems(schema.types.domains),
      });
    }
    groups.push({
      name: "types",
      groups: typeGroups,
    });
  }

  // Collations
  if (
    schema.collations.create.length +
      schema.collations.alter.length +
      schema.collations.drop.length >
    0
  ) {
    groups.push({
      name: "collations",
      items: changeGroupToItems(schema.collations),
    });
  }

  // Foreign Tables
  const foreignTableNames = Object.keys(schema.foreignTables).sort();
  if (foreignTableNames.length > 0) {
    const ftGroups: TreeGroup[] = [];
    for (const ftName of foreignTableNames) {
      const ft = schema.foreignTables[ftName];
      const structuralChanges = filterStructuralChanges(ft.changes);
      const symbol = getEntitySymbol(structuralChanges);
      ftGroups.push({
        name: `${symbol} ${ftName}`,
        groups: buildTableChildrenTree(ft),
      });
    }
    groups.push({
      name: "foreign-tables",
      groups: ftGroups,
    });
  }

  return groups;
}

/**
 * Build a generic tree structure from a HierarchicalPlan.
 */
export function buildPlanTree(plan: HierarchicalPlan): TreeGroup {
  const rootGroups: TreeGroup[] = [];

  // Cluster-wide objects
  const clusterGroups = buildClusterTree(plan.cluster);
  if (clusterGroups.length > 0) {
    rootGroups.push({
      name: "cluster",
      groups: clusterGroups,
    });
  }

  // Schema-scoped objects
  const schemaNames = Object.keys(plan.schemas).sort();
  if (schemaNames.length > 0) {
    const schemaGroups: TreeGroup[] = [];
    for (const schemaName of schemaNames) {
      const schema = plan.schemas[schemaName];
      const structuralChanges = filterStructuralChanges(schema.changes);
      const symbol = getEntitySymbol(structuralChanges);
      const childGroups = buildSchemaTree(schema);
      
      // Only include schemas that have changes (structural changes or child objects with changes)
      const hasSchemaChanges = structuralChanges.create.length > 0 ||
        structuralChanges.alter.length > 0 ||
        structuralChanges.drop.length > 0;
      
      if (hasSchemaChanges || childGroups.length > 0) {
        schemaGroups.push({
          name: `${symbol} ${schemaName}`,
          groups: childGroups,
        });
      }
    }
    
    // Only add database group if there are schemas with changes
    if (schemaGroups.length > 0) {
      rootGroups.push({
        name: "database",
        groups: [
          {
            name: "schemas",
            groups: schemaGroups,
          },
        ],
      });
    }
  }

  return {
    name: "Migration Plan",
    groups: rootGroups,
  };
}
