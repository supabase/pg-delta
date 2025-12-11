/**
 * Plan creation - the main entry point for creating migration plans.
 */

import postgres from "postgres";
import { diffCatalogs } from "../catalog.diff.ts";
import type { Catalog } from "../catalog.model.ts";
import { extractCatalog } from "../catalog.model.ts";
import type { Change } from "../change.types.ts";
import type { DiffContext } from "../context.ts";
import { buildPlanScopeFingerprint, hashStableIds } from "../fingerprint.ts";
import { postgresConfig } from "../postgres-config.ts";
import { sortChanges } from "../sort/sort-changes.ts";
import type { CreatePlanOptions, Plan } from "./types.ts";

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
import type { Sql } from "postgres";

type ConnectionInput = string | Sql;

export async function createPlan(
  from: ConnectionInput,
  to: ConnectionInput,
  options: CreatePlanOptions = {},
): Promise<{ plan: Plan; sortedChanges: Change[]; ctx: DiffContext } | null> {
  const fromSql =
    typeof from === "string" ? postgres(from, postgresConfig) : (from as Sql);
  const toSql =
    typeof to === "string" ? postgres(to, postgresConfig) : (to as Sql);
  const shouldCloseFrom = typeof from === "string";
  const shouldCloseTo = typeof to === "string";

  try {
    const [fromCatalog, toCatalog] = await Promise.all([
      extractCatalog(fromSql),
      extractCatalog(toSql),
    ]);

    return buildPlanForCatalogs(fromCatalog, toCatalog, options);
  } finally {
    const closers: Promise<unknown>[] = [];
    if (shouldCloseFrom) closers.push(fromSql.end());
    if (shouldCloseTo) closers.push(toSql.end());
    if (closers.length) {
      await Promise.all(closers);
    }
  }
}

/**
 * Build a plan (and supporting artifacts) from already extracted catalogs.
 */
function buildPlanForCatalogs(
  fromCatalog: Catalog,
  toCatalog: Catalog,
  options: CreatePlanOptions = {},
): { plan: Plan; sortedChanges: Change[]; ctx: DiffContext } | null {
  const changes = diffCatalogs(fromCatalog, toCatalog);

  const integration = options.integration;
  const ctx: DiffContext = {
    mainCatalog: fromCatalog,
    branchCatalog: toCatalog,
  };

  const integrationFilter = integration?.filter;
  const filteredChanges = integrationFilter
    ? changes.filter((change) => integrationFilter(ctx, change))
    : changes;

  if (filteredChanges.length === 0) {
    return null;
  }

  const sortedChanges = sortChanges(ctx, filteredChanges);
  const plan = buildPlan(ctx, sortedChanges, integration);

  return { plan, sortedChanges, ctx };
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
  integration?: CreatePlanOptions["integration"],
): Plan {
  const statements = generateStatements(ctx, changes, integration);

  const { hash: fingerprintFrom, stableIds } = buildPlanScopeFingerprint(
    ctx.mainCatalog,
    changes,
  );
  const fingerprintTo = hashStableIds(ctx.branchCatalog, stableIds);

  return {
    version: 1,
    source: { fingerprint: fingerprintFrom },
    target: { fingerprint: fingerprintTo },
    statements,
  };
}

/**
 * Generate the individual SQL statements that make up the plan.
 */
function generateStatements(
  ctx: DiffContext,
  changes: Change[],
  integration?: CreatePlanOptions["integration"],
): string[] {
  const statements: string[] = [];

  if (hasRoutineChanges(changes)) {
    statements.push("SET check_function_bodies = false");
  }

  for (const change of changes) {
    const sql = integration?.serialize?.(ctx, change) ?? change.serialize();
    statements.push(sql);
  }

  return statements;
}

function hasRoutineChanges(changes: Change[]): boolean {
  return changes.some(
    (change) =>
      change.objectType === "procedure" || change.objectType === "aggregate",
  );
}

// ============================================================================
// Flat Organization Helpers
// ============================================================================
