/**
 * Plan application - execute migration plans against target databases.
 */

import postgres, { type Sql } from "postgres";
import { diffCatalogs } from "../catalog.diff.ts";
import { extractCatalog } from "../catalog.model.ts";
import type { DiffContext } from "../context.ts";
import { buildPlanScopeFingerprint, hashStableIds } from "../fingerprint.ts";
import { compileFilterDSL } from "../integrations/filter/dsl.ts";
import { postgresConfig } from "../postgres-config.ts";
import { sortChanges } from "../sort/sort-changes.ts";
import type { Plan } from "./types.ts";

type ApplyPlanResult =
  | { status: "invalid_plan"; message: string }
  | { status: "fingerprint_mismatch"; current: string; expected: string }
  | { status: "already_applied" }
  | { status: "applied"; statements: number; warnings?: string[] }
  | { status: "failed"; error: unknown; script: string };

interface ApplyPlanOptions {
  verifyPostApply?: boolean;
}

type ConnectionInput = string | Sql;

/**
 * Check if a statement is a session configuration statement (standalone SET statements).
 * These statements should not be counted as changes.
 */
function isSessionStatement(statement: string): boolean {
  return statement.trim().startsWith("SET ");
}

/**
 * Apply a plan's SQL statements to a target database with integrity checks.
 * Validates fingerprints before and after application to ensure plan integrity.
 */

export async function applyPlan(
  plan: Plan,
  source: ConnectionInput,
  target: ConnectionInput,
  options: ApplyPlanOptions = {},
): Promise<ApplyPlanResult> {
  if (!plan.statements || plan.statements.length === 0) {
    return {
      status: "invalid_plan",
      message: "Plan contains no SQL statements to execute.",
    };
  }

  const currentSql =
    typeof source === "string"
      ? postgres(source, postgresConfig)
      : (source as Sql);
  const desiredSql =
    typeof target === "string"
      ? postgres(target, postgresConfig)
      : (target as Sql);
  const shouldCloseCurrent = typeof source === "string";
  const shouldCloseDesired = typeof target === "string";

  try {
    // Recompute stableIds and fingerprints from current and desired catalogs
    const [currentCatalog, desiredCatalog] = await Promise.all([
      extractCatalog(currentSql),
      extractCatalog(desiredSql),
    ]);

    const changes = diffCatalogs(currentCatalog, desiredCatalog);
    const ctx: DiffContext = {
      mainCatalog: currentCatalog,
      branchCatalog: desiredCatalog,
    };

    // Apply the same filter that was used to create the plan (if any)
    let filteredChanges = changes;
    if (plan.filter) {
      const filterFn = compileFilterDSL(plan.filter);
      filteredChanges = filteredChanges.filter((change) => filterFn(change));
    }

    const sortedChanges = sortChanges(ctx, filteredChanges);
    const { hash: fingerprintFrom, stableIds } = buildPlanScopeFingerprint(
      ctx.mainCatalog,
      sortedChanges,
    );
    // We intentionally recompute target fingerprint only after applying.

    // Pre-apply fingerprint validation
    if (fingerprintFrom === plan.target.fingerprint) {
      return { status: "already_applied" };
    }

    if (fingerprintFrom !== plan.source.fingerprint) {
      return {
        status: "fingerprint_mismatch",
        current: fingerprintFrom,
        expected: plan.source.fingerprint,
      };
    }

    // Execute the SQL script
    // TODO: mark statements that can't be run within a transaction
    const statements = plan.statements;

    const script = (() => {
      const joined = statements.join(";\n");
      return joined.endsWith(";") ? joined : `${joined};`;
    })();

    try {
      await currentSql.unsafe(script);
    } catch (error) {
      return { status: "failed", error, script };
    }

    const warnings: string[] = [];

    if (options.verifyPostApply !== false) {
      try {
        const updatedCatalog = await extractCatalog(currentSql);
        const updatedFingerprint = hashStableIds(updatedCatalog, stableIds);
        if (updatedFingerprint !== plan.target.fingerprint) {
          warnings.push(
            "Post-apply fingerprint does not match the plan target fingerprint.",
          );
        }
      } catch (error) {
        warnings.push(
          `Could not verify post-apply fingerprint: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // Count only actual changes, excluding session configuration statements
    const changeStatements = statements.filter(
      (stmt) => !isSessionStatement(stmt),
    );

    return {
      status: "applied",
      statements: changeStatements.length,
      warnings: warnings.length ? warnings : undefined,
    };
  } finally {
    const closers: Promise<unknown>[] = [];
    if (shouldCloseCurrent) closers.push(currentSql.end());
    if (shouldCloseDesired) closers.push(desiredSql.end());
    if (closers.length) {
      await Promise.all(closers);
    }
  }
}
