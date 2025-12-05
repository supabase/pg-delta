import postgres from "postgres";
import { extractCatalog } from "../catalog.model.ts";
import { hashStableIds, sha256 } from "../fingerprint.ts";
import { postgresConfig } from "../postgres-config.ts";
import type { Plan } from "./types.ts";

type ApplyPlanResult =
  | { status: "invalid_plan"; message: string }
  | { status: "fingerprint_mismatch"; current: string; expected: string }
  | { status: "already_applied" }
  | { status: "applied"; statements: number; warnings?: string[] }
  | { status: "failed"; error: unknown; failedStatement?: string };

interface ApplyPlanOptions {
  verifyPostApply?: boolean;
}

/**
 * Apply a plan's SQL to a target database with integrity checks.
 */
export async function applyPlan(
  plan: Plan,
  targetUrl: string,
  options: ApplyPlanOptions = {},
): Promise<ApplyPlanResult> {
  if (!plan.sql || plan.sql.trim().length === 0) {
    return {
      status: "invalid_plan",
      message: "Plan contains no SQL to execute.",
    };
  }

  const computedSqlHash = sha256(plan.sql);
  if (computedSqlHash !== plan.sqlHash) {
    return {
      status: "invalid_plan",
      message:
        "Plan SQL hash mismatch; aborting to avoid applying a tampered or outdated plan.",
    };
  }

  const sql = postgres(targetUrl, postgresConfig);

  try {
    // Pre-apply fingerprint validation
    const currentCatalog = await extractCatalog(sql);
    const currentFingerprint = hashStableIds(currentCatalog, plan.stableIds);

    if (currentFingerprint === plan.fingerprintTo) {
      return { status: "already_applied" };
    }

    if (currentFingerprint !== plan.fingerprintFrom) {
      return {
        status: "fingerprint_mismatch",
        current: currentFingerprint,
        expected: plan.fingerprintFrom,
      };
    }

    // Execute the SQL script
    const statements = plan.sql
      .split(";\n\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s !== ";");

    let failedStatement: string | undefined;

    try {
      await sql.begin(async (tx) => {
        for (const statement of statements) {
          const cleanStatement = statement.replace(/;\s*$/, "");
          if (cleanStatement.length === 0) continue;

          try {
            await tx.unsafe(cleanStatement);
          } catch (error) {
            failedStatement = cleanStatement;
            throw error;
          }
        }
      });
    } catch (error) {
      return { status: "failed", error, failedStatement };
    }

    const warnings: string[] = [];

    if (options.verifyPostApply !== false) {
      try {
        const updatedCatalog = await extractCatalog(sql);
        const updatedFingerprint = hashStableIds(
          updatedCatalog,
          plan.stableIds,
        );
        if (updatedFingerprint !== plan.fingerprintTo) {
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

    return {
      status: "applied",
      statements: statements.length,
      warnings: warnings.length ? warnings : undefined,
    };
  } finally {
    await sql.end();
  }
}
