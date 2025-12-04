/**
 * Builds a generic tree structure from a HierarchicalPlan.
 * Shows only structural changes (scope === "object"), grouped for readability.
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
import { getObjectName } from "../../core/plan/serialize.ts";
import type { TreeGroup, TreeItem } from "./tree-renderer.ts";

function structural(group: ChangeGroup): ChangeGroup {
  const onlyStructural = (entry: ChangeEntry) =>
    entry.original.scope === "object";
  return {
    create: group.create.filter(onlyStructural),
    alter: group.alter.filter(onlyStructural),
    drop: group.drop.filter(onlyStructural),
  };
}

function hasStructural(group: ChangeGroup): boolean {
  const g = structural(group);
  return g.create.length + g.alter.length + g.drop.length > 0;
}

function symbol(group: ChangeGroup): string {
  const g = structural(group);
  if (g.create.length > 0) return "+";
  if (g.alter.length > 0) return "~";
  if (g.drop.length > 0) return "-";
  return "";
}

function displayName(entry: ChangeEntry): string {
  const { original } = entry;
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
  return getObjectName(original);
}

function toItems(group: ChangeGroup): TreeItem[] {
  const items: TreeItem[] = [];
  const s = structural(group);
  for (const entry of s.create) {
    items.push({ name: `+ ${displayName(entry)}` });
  }
  for (const entry of s.alter) {
    items.push({ name: `~ ${displayName(entry)}` });
  }
  for (const entry of s.drop) {
    items.push({ name: `- ${displayName(entry)}` });
  }
  return items;
}

function tableChildren(
  table: HierarchicalPlan["schemas"][string]["tables"][string],
): TreeGroup[] {
  const groups: TreeGroup[] = [];

  const pushGroup = (name: string, grp: ChangeGroup) => {
    if (hasStructural(grp)) {
      const items = toItems(grp);
      const label = items.length > 0 ? `${name} (${items.length})` : name;
      groups.push({ name: label, items });
    }
  };

  pushGroup("columns", table.columns);
  pushGroup("indexes", table.indexes);
  pushGroup("triggers", table.triggers);
  pushGroup("rules", table.rules);
  pushGroup("policies", table.policies);

  const partitionNames = Object.keys(table.partitions).sort();
  if (partitionNames.length > 0) {
    const partitionGroups = partitionNames
      .map((name) => {
        const part = table.partitions[name];
        const sym = tableSymbol(part);
        const childGroups = tableChildren(part);
        if (!hasStructural(part.changes) && childGroups.length === 0) {
          return null;
        }
        return {
          name: sym ? `${sym} ${name}` : name,
          groups: childGroups,
        };
      })
      .filter(Boolean) as TreeGroup[];
    if (partitionGroups.length > 0) {
      groups.push({
        name: `partitions (${partitionGroups.length})`,
        groups: partitionGroups,
      });
    }
  }

  return groups;
}

function tableSymbol(
  table: HierarchicalPlan["schemas"][string]["tables"][string],
): string {
  const own = symbol(table.changes);
  if (own) return own;
  const childSymbols = [
    symbol(table.columns),
    symbol(table.indexes),
    symbol(table.triggers),
    symbol(table.rules),
    symbol(table.policies),
  ];
  if (childSymbols.includes("+")) return "+";
  if (childSymbols.includes("~")) return "~";
  if (childSymbols.includes("-")) return "-";
  for (const part of Object.values(table.partitions)) {
    const s = tableSymbol(part);
    if (s) return s;
  }
  return "";
}

function matviewSymbol(
  mv: HierarchicalPlan["schemas"][string]["materializedViews"][string],
): string {
  const own = symbol(mv.changes);
  if (own) return own;
  const child = symbol(mv.indexes);
  return child;
}

function matviewChildren(
  mv: HierarchicalPlan["schemas"][string]["materializedViews"][string],
): TreeGroup[] {
  const groups: TreeGroup[] = [];
  if (hasStructural(mv.indexes)) {
    groups.push({ name: "indexes", items: toItems(mv.indexes) });
  }
  return groups;
}

function buildCluster(cluster: HierarchicalPlan["cluster"]): TreeGroup[] {
  const groups: Array<[string, ChangeGroup]> = [
    ["roles", cluster.roles],
    ["extensions", cluster.extensions],
    ["event-triggers", cluster.eventTriggers],
    ["publications", cluster.publications],
    ["subscriptions", cluster.subscriptions],
    ["foreign-data-wrappers", cluster.foreignDataWrappers],
    ["servers", cluster.servers],
    ["user-mappings", cluster.userMappings],
  ];

  return groups
    .filter(([, grp]) => hasStructural(grp))
    .map(([name, grp]) => {
      const items = toItems(grp);
      const label = items.length > 0 ? `${name} (${items.length})` : name;
      return { name: label, items };
    });
}

function buildSchema(schema: HierarchicalPlan["schemas"][string]): TreeGroup[] {
  const groups: TreeGroup[] = [];

  const pushItems = (name: string, grp: ChangeGroup) => {
    if (hasStructural(grp)) groups.push({ name, items: toItems(grp) });
  };

  const tableNames = Object.keys(schema.tables).sort();
  if (tableNames.length > 0) {
    const tableGroups = tableNames
      .map((name) => {
        const table = schema.tables[name];
        const sym = tableSymbol(table);
        const children = tableChildren(table);
        if (!hasStructural(table.changes) && children.length === 0) return null;
        return { name: sym ? `${sym} ${name}` : name, groups: children };
      })
      .filter(Boolean) as TreeGroup[];
    if (tableGroups.length > 0) {
      groups.push({
        name: `tables (${tableGroups.length})`,
        groups: tableGroups,
      });
    }
  }

  const viewNames = Object.keys(schema.views).sort();
  if (viewNames.length > 0) {
    const viewGroups = viewNames
      .map((name) => {
        const view = schema.views[name];
        const sym = tableSymbol(view);
        const children = tableChildren(view);
        if (!hasStructural(view.changes) && children.length === 0) return null;
        return { name: sym ? `${sym} ${name}` : name, groups: children };
      })
      .filter(Boolean) as TreeGroup[];
    if (viewGroups.length > 0) {
      groups.push({
        name: `views (${viewGroups.length})`,
        groups: viewGroups,
      });
    }
  }

  const mvNames = Object.keys(schema.materializedViews).sort();
  if (mvNames.length > 0) {
    const mvGroups = mvNames
      .map((name) => {
        const mv = schema.materializedViews[name];
        const sym = matviewSymbol(mv);
        const children = matviewChildren(mv);
        if (!hasStructural(mv.changes) && children.length === 0) return null;
        return { name: sym ? `${sym} ${name}` : name, groups: children };
      })
      .filter(Boolean) as TreeGroup[];
    if (mvGroups.length > 0) {
      groups.push({
        name: `materialized-views (${mvGroups.length})`,
        groups: mvGroups,
      });
    }
  }

  pushItems("functions", schema.functions);
  pushItems("procedures", schema.procedures);
  pushItems("aggregates", schema.aggregates);
  pushItems("sequences", schema.sequences);

  const typeGroups: TreeGroup[] = [];
  if (hasStructural(schema.types.enums)) {
    typeGroups.push({ name: "enums", items: toItems(schema.types.enums) });
  }
  if (hasStructural(schema.types.composites)) {
    typeGroups.push({
      name: "composite-types",
      items: toItems(schema.types.composites),
    });
  }
  if (hasStructural(schema.types.ranges)) {
    typeGroups.push({ name: "ranges", items: toItems(schema.types.ranges) });
  }
  if (hasStructural(schema.types.domains)) {
    typeGroups.push({ name: "domains", items: toItems(schema.types.domains) });
  }
  if (typeGroups.length > 0) {
    groups.push({ name: `types (${typeGroups.length})`, groups: typeGroups });
  }

  pushItems("collations", schema.collations);

  const ftNames = Object.keys(schema.foreignTables).sort();
  if (ftNames.length > 0) {
    const ftGroups = ftNames
      .map((name) => {
        const ft = schema.foreignTables[name];
        const sym = tableSymbol(ft);
        const children = tableChildren(ft);
        if (!hasStructural(ft.changes) && children.length === 0) return null;
        return { name: sym ? `${sym} ${name}` : name, groups: children };
      })
      .filter(Boolean) as TreeGroup[];
    if (ftGroups.length > 0) {
      groups.push({
        name: `foreign-tables (${ftGroups.length})`,
        groups: ftGroups,
      });
    }
  }

  return groups;
}

/**
 * Build a generic tree structure from a HierarchicalPlan.
 */
export function buildPlanTree(plan: HierarchicalPlan): TreeGroup {
  const rootGroups: TreeGroup[] = [];

  const clusterGroups = buildCluster(plan.cluster);
  if (clusterGroups.length > 0) {
    rootGroups.push({ name: "cluster", groups: clusterGroups });
  }

  const schemaNames = Object.keys(plan.schemas).sort();
  if (schemaNames.length > 0) {
    const schemaGroups = schemaNames
      .map((schemaName) => {
        const schema = plan.schemas[schemaName];
        const sym = symbol(schema.changes);
        const children = buildSchema(schema);
        if (!hasStructural(schema.changes) && children.length === 0) {
          return null;
        }
        const label = sym ? `${sym} ${schemaName}` : schemaName;
        return { name: label, groups: children };
      })
      .filter(Boolean) as TreeGroup[];

    if (schemaGroups.length > 0) {
      rootGroups.push({
        name: "database",
        groups: [{ name: "schemas", groups: schemaGroups }],
      });
    }
  }

  return { name: "Migration Plan", groups: rootGroups };
}
