/**
 * Plan creation - the main entry point for creating migration plans.
 */

import postgres from "postgres";
import { diffCatalogs } from "../catalog.diff.ts";
import { extractCatalog } from "../catalog.model.ts";
import type { Change } from "../change.types.ts";
import type { DiffContext } from "../context.ts";
import { base } from "../integrations/base.ts";
import type { Integration } from "../integrations/integration.types.ts";
import { postgresConfig } from "../postgres-config.ts";
import { sortChanges } from "../sort/sort-changes.ts";
import { serializeChange } from "./serialize.ts";
import type {
  ChangesByObjectType,
  ChangesByOperation,
  CreatePlanOptions,
  Plan,
  PlanStats,
  SerializedChange,
} from "./types.ts";

// ============================================================================
// Plan Creation
// ============================================================================

/**
 * Create a migration plan by comparing two databases.
 *
 * @param fromUrl - Source database connection URL (current state)
 * @param toUrl - Target database connection URL (desired state)
 * @param options - Optional configuration
 * @returns A Plan if there are changes, null if databases are identical
 */
export async function createPlan(
  fromUrl: string,
  toUrl: string,
  options: CreatePlanOptions = {},
): Promise<Plan | null> {
  const fromSql = postgres(fromUrl, postgresConfig);
  const toSql = postgres(toUrl, postgresConfig);

  try {
    const [fromCatalog, toCatalog] = await Promise.all([
      extractCatalog(fromSql),
      extractCatalog(toSql),
    ]);

    const changes = diffCatalogs(fromCatalog, toCatalog);

    const integration = options.integration ?? base;
    const ctx: DiffContext = {
      mainCatalog: fromCatalog,
      branchCatalog: toCatalog,
    };

    const integrationFilter = integration.filter;
    const filteredChanges = integrationFilter
      ? changes.filter((change) => integrationFilter(ctx, change))
      : changes;

    if (filteredChanges.length === 0) {
      return null;
    }

    const sortedChanges = sortChanges(ctx, filteredChanges);

    return buildPlan(ctx, sortedChanges, integration);
  } finally {
    await Promise.all([fromSql.end(), toSql.end()]);
  }
}

// ============================================================================
// Plan Building
// ============================================================================

/**
 * Build a Plan from sorted changes.
 */
function buildPlan(
  ctx: DiffContext,
  changes: Change[],
  integration: Integration,
): Plan {
  const serializedChanges = changes.map((change) =>
    serializeChange(ctx, change, integration),
  );

  const sql = generateSqlScript(ctx, changes, integration);
  const stats = computeStats(serializedChanges);

  return {
    changes: serializedChanges,
    sql,
    stats,
  };
}

/**
 * Generate the complete SQL migration script.
 */
function generateSqlScript(
  ctx: DiffContext,
  changes: Change[],
  integration: Integration,
): string {
  const hasRoutineChanges = changes.some(
    (change) =>
      change.objectType === "procedure" || change.objectType === "aggregate",
  );

  const parts: string[] = [];

  if (hasRoutineChanges) {
    parts.push("SET check_function_bodies = false");
  }

  for (const change of changes) {
    const sql = integration.serialize?.(ctx, change) ?? change.serialize();
    parts.push(sql);
  }

  return `${parts.join(";\n\n")};`;
}

/**
 * Compute statistics about the changes.
 */
function computeStats(changes: SerializedChange[]): PlanStats {
  const stats: PlanStats = {
    total: changes.length,
    creates: 0,
    alters: 0,
    drops: 0,
    byObjectType: {},
  };

  for (const change of changes) {
    switch (change.operation) {
      case "create":
        stats.creates++;
        break;
      case "alter":
        stats.alters++;
        break;
      case "drop":
        stats.drops++;
        break;
    }

    stats.byObjectType[change.objectType] =
      (stats.byObjectType[change.objectType] ?? 0) + 1;
  }

  return stats;
}

// ============================================================================
// Flat Organization Helpers
// ============================================================================

/**
 * Group changes by object type (flat structure).
 */
export function groupChangesByObjectType(
  changes: SerializedChange[],
): ChangesByObjectType {
  const grouped: ChangesByObjectType = {};

  for (const change of changes) {
    if (!grouped[change.objectType]) {
      grouped[change.objectType] = [];
    }
    grouped[change.objectType].push(change);
  }

  return grouped;
}

/**
 * Group changes by operation (flat structure).
 */
export function groupChangesByOperation(
  changes: SerializedChange[],
): ChangesByOperation {
  const grouped: ChangesByOperation = {
    create: [],
    alter: [],
    drop: [],
  };

  for (const change of changes) {
    grouped[change.operation].push(change);
  }

  return grouped;
}
