/**
 * Tree formatter for displaying plans hierarchically (compact mode).
 */

import chalk from "chalk";
import type { HierarchicalPlan, PlanStats } from "../../../core/plan/index.ts";
import { buildPlanTree } from "./tree-builder.ts";
import { renderTree } from "./tree-renderer.ts";

/**
 * Format a plan as a tree structure (compact mode).
 */
export function formatTree(plan: HierarchicalPlan, stats: PlanStats): string {
  const lines: string[] = [];

  // Summary
  lines.push(
    chalk.bold(
      `📋 Migration Plan: ${stats.total} change${stats.total !== 1 ? "s" : ""}`,
    ),
  );
  const summary = buildSummaryLine(plan);
  if (summary) {
    lines.push("");
    lines.push("Summary:");
    lines.push(summary);
  }
  lines.push("");

  // Build generic tree structure and render it
  const tree = buildPlanTree(plan);
  const treeOutput = renderTree(tree);
  lines.push(treeOutput);

  // Legend
  lines.push("");
  lines.push(
    `${chalk.green("+")} create   ${chalk.yellow("~")} alter   ${chalk.red("-")} drop`,
  );

  return lines.join("\n");
}

/**
 * Build summary as a table showing counts by entity type and operation.
 */
function buildSummaryLine(plan: HierarchicalPlan): string {
  // Count by object type
  const byType: Record<
    string,
    { create: number; alter: number; drop: number }
  > = {};
  countFromHierarchy(plan, byType);

  // Filter to only types with changes
  const entries = Object.entries(byType).filter(
    ([, counts]) => counts.create + counts.alter + counts.drop > 0,
  );

  if (entries.length === 0) {
    return "";
  }

  // Calculate column widths
  let maxNameWidth = 0;
  let maxCreateWidth = 0;
  let maxAlterWidth = 0;
  let maxDropWidth = 0;

  for (const [type, counts] of entries) {
    const typeStr = type.replace(/_/g, "-");
    maxNameWidth = Math.max(maxNameWidth, typeStr.length);
    // For width calculation, use "1" instead of "0" since we'll show "-" for zeros
    maxCreateWidth = Math.max(
      maxCreateWidth,
      counts.create > 0 ? counts.create.toString().length : 1,
    );
    maxAlterWidth = Math.max(
      maxAlterWidth,
      counts.alter > 0 ? counts.alter.toString().length : 1,
    );
    maxDropWidth = Math.max(
      maxDropWidth,
      counts.drop > 0 ? counts.drop.toString().length : 1,
    );
  }

  // Ensure minimum widths for headers
  maxNameWidth = Math.max(maxNameWidth, "Entity".length);
  maxCreateWidth = Math.max(maxCreateWidth, "Create".length);
  maxAlterWidth = Math.max(maxAlterWidth, "Alter".length);
  maxDropWidth = Math.max(maxDropWidth, "Drop".length);

  const lines: string[] = [];

  // Header
  lines.push(
    `  ${chalk.bold("Entity".padEnd(maxNameWidth))}  ${chalk.bold("Create".padStart(maxCreateWidth))}  ${chalk.bold("Alter".padStart(maxAlterWidth))}  ${chalk.bold("Drop".padStart(maxDropWidth))}`,
  );
  lines.push(
    `  ${chalk.dim("-".repeat(maxNameWidth))}  ${chalk.dim("-".repeat(maxCreateWidth))}  ${chalk.dim("-".repeat(maxAlterWidth))}  ${chalk.dim("-".repeat(maxDropWidth))}`,
  );

  // Rows
  for (const [type, counts] of entries.sort(([a], [b]) => a.localeCompare(b))) {
    const typeStr = type.replace(/_/g, "-");
    // Format numbers: show "-" for 0, pad and colorize
    const createDisplay = counts.create > 0 ? counts.create.toString() : "-";
    const alterDisplay = counts.alter > 0 ? counts.alter.toString() : "-";
    const dropDisplay = counts.drop > 0 ? counts.drop.toString() : "-";

    const createStr =
      counts.create > 0
        ? chalk.green(createDisplay.padStart(maxCreateWidth))
        : chalk.dim(createDisplay.padStart(maxCreateWidth));
    const alterStr =
      counts.alter > 0
        ? chalk.yellow(alterDisplay.padStart(maxAlterWidth))
        : chalk.dim(alterDisplay.padStart(maxAlterWidth));
    const dropStr =
      counts.drop > 0
        ? chalk.red(dropDisplay.padStart(maxDropWidth))
        : chalk.dim(dropDisplay.padStart(maxDropWidth));

    lines.push(
      `  ${typeStr.padEnd(maxNameWidth)}  ${createStr}  ${alterStr}  ${dropStr}`,
    );
  }

  return lines.join("\n");
}

/**
 * Count changes by type from hierarchy.
 */
function countFromHierarchy(
  plan: HierarchicalPlan,
  byType: Record<string, { create: number; alter: number; drop: number }>,
): void {
  function countGroup(
    group: {
      create: ChangeEntry[];
      alter: ChangeEntry[];
      drop: ChangeEntry[];
    },
    type: string,
  ) {
    if (!byType[type]) {
      byType[type] = { create: 0, alter: 0, drop: 0 };
    }
    byType[type].create += group.create.length;
    byType[type].alter += group.alter.length;
    byType[type].drop += group.drop.length;
  }

  // Cluster
  countGroup(plan.cluster.roles, "role");
  countGroup(plan.cluster.extensions, "extension");
  countGroup(plan.cluster.eventTriggers, "event-trigger");
  countGroup(plan.cluster.publications, "publication");
  countGroup(plan.cluster.subscriptions, "subscription");

  // Schemas
  for (const schema of Object.values(plan.schemas)) {
    countGroup(schema.changes, "schema");
    countGroup(schema.functions, "function");
    countGroup(schema.procedures, "procedure");
    countGroup(schema.aggregates, "aggregate");
    countGroup(schema.sequences, "sequence");
    countGroup(schema.collations, "collation");

    // Tables
    for (const table of Object.values(schema.tables)) {
      countGroup(table.changes, "table");
      countGroup(table.columns, "column");
      countGroup(table.indexes, "index");
      countGroup(table.triggers, "trigger");
      countGroup(table.rules, "rule");
      countGroup(table.policies, "policy");
    }

    // Views
    for (const view of Object.values(schema.views)) {
      countGroup(view.changes, "view");
    }

    // Materialized views
    for (const matview of Object.values(schema.materializedViews)) {
      countGroup(matview.changes, "materialized-view");
    }

    // Types
    countGroup(schema.types.enums, "enum");
    countGroup(schema.types.composites, "composite-type");
    countGroup(schema.types.ranges, "range");
    countGroup(schema.types.domains, "domain");
  }
}

import type { ChangeEntry } from "../../../core/plan/index.ts";
