/**
 * Tree formatter for displaying plans hierarchically.
 */

import type {
  HierarchicalPlan,
  SerializedChange,
} from "../../core/plan/index.ts";

/**
 * Format a plan as a tree structure.
 */
export function formatTree(
  plan: HierarchicalPlan,
  stats: { total: number },
): string {
  const lines: string[] = [];

  // Header
  lines.push(
    `📋 Migration Plan: ${stats.total} change${stats.total !== 1 ? "s" : ""}`,
  );
  lines.push("");

  // Cluster-wide objects
  const clusterHasChanges = hasClusterChanges(plan.cluster);
  if (clusterHasChanges) {
    lines.push("🌐 Cluster");
    formatClusterGroup(lines, plan.cluster, "  ");
  }

  // Schema-scoped objects
  const schemaNames = Object.keys(plan.schemas).sort();
  if (schemaNames.length > 0) {
    lines.push("📁 Schemas");
    for (const schemaName of schemaNames) {
      const schema = plan.schemas[schemaName];
      lines.push(`  └── ${schemaName}`);
      formatSchemaGroup(lines, schema, "    ");
    }
  }

  // Legend
  lines.push("");
  lines.push("Legend: ✚ create  ~ alter  ✖ drop");

  return lines.join("\n");
}

/**
 * Check if cluster group has any changes.
 */
function hasClusterChanges(cluster: HierarchicalPlan["cluster"]): boolean {
  return (
    cluster.roles.create.length +
      cluster.roles.alter.length +
      cluster.roles.drop.length +
      cluster.extensions.create.length +
      cluster.extensions.alter.length +
      cluster.extensions.drop.length +
      cluster.eventTriggers.create.length +
      cluster.eventTriggers.alter.length +
      cluster.eventTriggers.drop.length +
      cluster.publications.create.length +
      cluster.publications.alter.length +
      cluster.publications.drop.length +
      cluster.subscriptions.create.length +
      cluster.subscriptions.alter.length +
      cluster.subscriptions.drop.length +
      cluster.foreignDataWrappers.create.length +
      cluster.foreignDataWrappers.alter.length +
      cluster.foreignDataWrappers.drop.length +
      cluster.servers.create.length +
      cluster.servers.alter.length +
      cluster.servers.drop.length +
      cluster.userMappings.create.length +
      cluster.userMappings.alter.length +
      cluster.userMappings.drop.length >
    0
  );
}

/**
 * Format cluster group.
 */
function formatClusterGroup(
  lines: string[],
  cluster: HierarchicalPlan["cluster"],
  indent: string,
): void {
  if (
    cluster.roles.create.length +
      cluster.roles.alter.length +
      cluster.roles.drop.length >
    0
  ) {
    lines.push(`${indent}└── Roles`);
    formatChangeGroup(lines, cluster.roles, `${indent}    `);
  }

  if (
    cluster.extensions.create.length +
      cluster.extensions.alter.length +
      cluster.extensions.drop.length >
    0
  ) {
    lines.push(`${indent}└── Extensions`);
    formatChangeGroup(lines, cluster.extensions, `${indent}    `);
  }

  if (
    cluster.eventTriggers.create.length +
      cluster.eventTriggers.alter.length +
      cluster.eventTriggers.drop.length >
    0
  ) {
    lines.push(`${indent}└── Event Triggers`);
    formatChangeGroup(lines, cluster.eventTriggers, `${indent}    `);
  }

  if (
    cluster.publications.create.length +
      cluster.publications.alter.length +
      cluster.publications.drop.length >
    0
  ) {
    lines.push(`${indent}└── Publications`);
    formatChangeGroup(lines, cluster.publications, `${indent}    `);
  }

  if (
    cluster.subscriptions.create.length +
      cluster.subscriptions.alter.length +
      cluster.subscriptions.drop.length >
    0
  ) {
    lines.push(`${indent}└── Subscriptions`);
    formatChangeGroup(lines, cluster.subscriptions, `${indent}    `);
  }

  if (
    cluster.foreignDataWrappers.create.length +
      cluster.foreignDataWrappers.alter.length +
      cluster.foreignDataWrappers.drop.length >
    0
  ) {
    lines.push(`${indent}└── Foreign Data Wrappers`);
    formatChangeGroup(lines, cluster.foreignDataWrappers, `${indent}    `);
  }

  if (
    cluster.servers.create.length +
      cluster.servers.alter.length +
      cluster.servers.drop.length >
    0
  ) {
    lines.push(`${indent}└── Servers`);
    formatChangeGroup(lines, cluster.servers, `${indent}    `);
  }

  if (
    cluster.userMappings.create.length +
      cluster.userMappings.alter.length +
      cluster.userMappings.drop.length >
    0
  ) {
    lines.push(`${indent}└── User Mappings`);
    formatChangeGroup(lines, cluster.userMappings, `${indent}    `);
  }
}

/**
 * Format schema group.
 */
function formatSchemaGroup(
  lines: string[],
  schema: HierarchicalPlan["schemas"][string],
  indent: string,
): void {
  // Schema-level changes
  if (
    schema.changes.create.length +
      schema.changes.alter.length +
      schema.changes.drop.length >
    0
  ) {
    lines.push(`${indent}└── Schema`);
    formatChangeGroup(lines, schema.changes, `${indent}    `);
  }

  // Tables
  const tableNames = Object.keys(schema.tables).sort();
  if (tableNames.length > 0) {
    lines.push(`${indent}└── Tables`);
    for (const tableName of tableNames) {
      const table = schema.tables[tableName];
      lines.push(`${indent}    └── ${tableName}`);
      formatTableChildren(lines, table, `${indent}        `);
    }
  }

  // Views
  const viewNames = Object.keys(schema.views).sort();
  if (viewNames.length > 0) {
    lines.push(`${indent}└── Views`);
    for (const viewName of viewNames) {
      const view = schema.views[viewName];
      lines.push(`${indent}    └── ${viewName}`);
      formatTableChildren(lines, view, `${indent}        `);
    }
  }

  // Materialized Views
  const matviewNames = Object.keys(schema.materializedViews).sort();
  if (matviewNames.length > 0) {
    lines.push(`${indent}└── Materialized Views`);
    for (const matviewName of matviewNames) {
      const matview = schema.materializedViews[matviewName];
      lines.push(`${indent}    └── ${matviewName}`);
      formatMaterializedViewChildren(lines, matview, `${indent}        `);
    }
  }

  // Functions
  if (
    schema.functions.create.length +
      schema.functions.alter.length +
      schema.functions.drop.length >
    0
  ) {
    lines.push(`${indent}└── Functions`);
    formatChangeGroup(lines, schema.functions, `${indent}    `);
  }

  // Procedures
  if (
    schema.procedures.create.length +
      schema.procedures.alter.length +
      schema.procedures.drop.length >
    0
  ) {
    lines.push(`${indent}└── Procedures`);
    formatChangeGroup(lines, schema.procedures, `${indent}    `);
  }

  // Aggregates
  if (
    schema.aggregates.create.length +
      schema.aggregates.alter.length +
      schema.aggregates.drop.length >
    0
  ) {
    lines.push(`${indent}└── Aggregates`);
    formatChangeGroup(lines, schema.aggregates, `${indent}    `);
  }

  // Sequences
  if (
    schema.sequences.create.length +
      schema.sequences.alter.length +
      schema.sequences.drop.length >
    0
  ) {
    lines.push(`${indent}└── Sequences`);
    formatChangeGroup(lines, schema.sequences, `${indent}    `);
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
    lines.push(`${indent}└── Types`);
    if (
      schema.types.enums.create.length +
        schema.types.enums.alter.length +
        schema.types.enums.drop.length >
      0
    ) {
      lines.push(`${indent}    └── Enums`);
      formatChangeGroup(lines, schema.types.enums, `${indent}        `);
    }
    if (
      schema.types.composites.create.length +
        schema.types.composites.alter.length +
        schema.types.composites.drop.length >
      0
    ) {
      lines.push(`${indent}    └── Composites`);
      formatChangeGroup(lines, schema.types.composites, `${indent}        `);
    }
    if (
      schema.types.ranges.create.length +
        schema.types.ranges.alter.length +
        schema.types.ranges.drop.length >
      0
    ) {
      lines.push(`${indent}    └── Ranges`);
      formatChangeGroup(lines, schema.types.ranges, `${indent}        `);
    }
    if (
      schema.types.domains.create.length +
        schema.types.domains.alter.length +
        schema.types.domains.drop.length >
      0
    ) {
      lines.push(`${indent}    └── Domains`);
      formatChangeGroup(lines, schema.types.domains, `${indent}        `);
    }
  }

  // Collations
  if (
    schema.collations.create.length +
      schema.collations.alter.length +
      schema.collations.drop.length >
    0
  ) {
    lines.push(`${indent}└── Collations`);
    formatChangeGroup(lines, schema.collations, `${indent}    `);
  }

  // Foreign Tables
  const foreignTableNames = Object.keys(schema.foreignTables).sort();
  if (foreignTableNames.length > 0) {
    lines.push(`${indent}└── Foreign Tables`);
    for (const ftName of foreignTableNames) {
      const ft = schema.foreignTables[ftName];
      lines.push(`${indent}    └── ${ftName}`);
      formatTableChildren(lines, ft, `${indent}        `);
    }
  }
}

/**
 * Format table children (includes columns, indexes, triggers, etc.).
 */
function formatTableChildren(
  lines: string[],
  table: HierarchicalPlan["schemas"][string]["tables"][string],
  indent: string,
): void {
  // Table-level changes
  if (
    table.changes.create.length +
      table.changes.alter.length +
      table.changes.drop.length >
    0
  ) {
    formatChangeGroup(lines, table.changes, indent);
  }

  // Columns
  if (
    table.columns.create.length +
      table.columns.alter.length +
      table.columns.drop.length >
    0
  ) {
    lines.push(`${indent}└── Columns`);
    formatChangeGroup(lines, table.columns, `${indent}    `);
  }

  // Indexes
  if (
    table.indexes.create.length +
      table.indexes.alter.length +
      table.indexes.drop.length >
    0
  ) {
    lines.push(`${indent}└── Indexes`);
    formatChangeGroup(lines, table.indexes, `${indent}    `);
  }

  // Triggers
  if (
    table.triggers.create.length +
      table.triggers.alter.length +
      table.triggers.drop.length >
    0
  ) {
    lines.push(`${indent}└── Triggers`);
    formatChangeGroup(lines, table.triggers, `${indent}    `);
  }

  // Rules
  if (
    table.rules.create.length +
      table.rules.alter.length +
      table.rules.drop.length >
    0
  ) {
    lines.push(`${indent}└── Rules`);
    formatChangeGroup(lines, table.rules, `${indent}    `);
  }

  // Policies
  if (
    table.policies.create.length +
      table.policies.alter.length +
      table.policies.drop.length >
    0
  ) {
    lines.push(`${indent}└── Policies`);
    formatChangeGroup(lines, table.policies, `${indent}    `);
  }

  // Partitions
  const partitionNames = Object.keys(table.partitions).sort();
  if (partitionNames.length > 0) {
    lines.push(`${indent}└── Partitions`);
    for (const partitionName of partitionNames) {
      const partition = table.partitions[partitionName];
      lines.push(`${indent}    └── ${partitionName}`);
      formatTableChildren(lines, partition, `${indent}        `);
    }
  }
}

/**
 * Format materialized view children.
 */
function formatMaterializedViewChildren(
  lines: string[],
  matview: HierarchicalPlan["schemas"][string]["materializedViews"][string],
  indent: string,
): void {
  if (
    matview.changes.create.length +
      matview.changes.alter.length +
      matview.changes.drop.length >
    0
  ) {
    formatChangeGroup(lines, matview.changes, indent);
  }

  if (
    matview.indexes.create.length +
      matview.indexes.alter.length +
      matview.indexes.drop.length >
    0
  ) {
    lines.push(`${indent}└── Indexes`);
    formatChangeGroup(lines, matview.indexes, `${indent}    `);
  }
}

/**
 * Format a change group (create/alter/drop).
 */
function formatChangeGroup(
  lines: string[],
  group: {
    create: SerializedChange[];
    alter: SerializedChange[];
    drop: SerializedChange[];
  },
  indent: string,
): void {
  for (const change of group.create) {
    lines.push(`${indent}✚ ${change.name}`);
  }
  for (const change of group.alter) {
    lines.push(`${indent}~ ${change.name}`);
  }
  for (const change of group.drop) {
    lines.push(`${indent}✖ ${change.name}`);
  }
}
