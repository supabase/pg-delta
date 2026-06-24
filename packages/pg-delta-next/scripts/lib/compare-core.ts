/**
 * Shared old-vs-new engine comparison logic for dogfooding scripts.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pool } from "pg";
import pg from "pg";
import { apply } from "../../src/apply/apply.ts";
import { diff } from "../../src/core/diff.ts";
import type { FactBase } from "../../src/core/fact.ts";
import { extract } from "../../src/extract/extract.ts";
import { resolveCliProfile } from "../../src/cli/profile.ts";
import { probeApplierCapability } from "../../src/policy/capability.ts";
import { plan, type Plan, type PlanOptions } from "../../src/plan/plan.ts";
import { serializePlan } from "../../src/plan/artifact.ts";
import { provePlan } from "../../src/proof/prove.ts";
import {
  applyPlan as oldApplyPlan,
  createPlan as oldCreatePlan,
  flattenOldPlanStatements,
  type OldPlan,
} from "../../tests/old-engine.ts";

export type ConvergenceBucket =
  | "both-converge"
  | "old-fails-new-converges"
  | "old-fingerprint-gate"
  | "new-fails-old-converges"
  | "accepted-difference-acl"
  | "both-fail"
  | "not-checked";

/** Pure bucket decision from the adjudicated convergence signals. Extracted so
 *  the classification is unit-testable without a live database.
 *
 *  `oldFingerprintGated` distinguishes the old engine refusing to apply on a
 *  clone because its own fingerprint safety gate tripped (status
 *  `fingerprint_mismatch`) from the old engine producing genuinely divergent
 *  SQL. The former is an artifact of the differential clone-apply harness, not
 *  evidence the new engine is more correct, so it gets its own bucket. */
export function decideConvergenceBucket(signals: {
  newConverges: boolean;
  oldConverges: boolean;
  oldAclDriftOnly: boolean;
  oldFingerprintGated: boolean;
}): ConvergenceBucket {
  const { newConverges, oldConverges, oldAclDriftOnly, oldFingerprintGated } =
    signals;
  if (newConverges && oldConverges) return "both-converge";
  if (newConverges && !oldConverges) {
    if (oldFingerprintGated) return "old-fingerprint-gate";
    return oldAclDriftOnly
      ? "accepted-difference-acl"
      : "old-fails-new-converges";
  }
  if (!newConverges && oldConverges) return "new-fails-old-converges";
  return "both-fail";
}

export interface CompareOptions {
  profile?: string;
  scenario: string;
  outDir: string;
  compact?: boolean;
  prove?: boolean;
  applyCheck?: boolean;
  setRolePostgres?: boolean;
}

export interface CompareMetrics {
  scenario: string;
  profile: string;
  old: {
    statementCount: number;
    charCount: number;
    planMs: number;
    statements: string[];
    planNull: boolean;
  };
  new: {
    statementCount: number;
    charCount: number;
    planMs: number;
    actionCount: number;
    safetyReport?: Plan["safetyReport"];
    filteredDeltaCount: number;
    renameCandidateCount: number;
    planError?: string;
  };
  prove?: {
    ok: boolean;
    proveMs: number;
    tablesChecked: number;
    tablesSkipped: number;
    driftDeltaCount: number;
  };
  applyCheck?: {
    bucket: ConvergenceBucket;
    oldConverges: boolean;
    newConverges: boolean;
    note?: string;
  };
  timing: {
    oldPlanMs: number;
    newPlanMs: number;
    totalMs: number;
  };
}

interface OldEngineSupabase {
  filter: unknown;
  serialize: unknown;
}

async function loadOldSupabaseIntegration(): Promise<OldEngineSupabase> {
  const path = new URL(
    "../../../pg-delta/src/core/integrations/supabase.ts",
    import.meta.url,
  ).href;
  const mod = (await import(path)) as { supabase: OldEngineSupabase };
  return mod.supabase;
}

async function resolveOldPlanOptions(
  profile: string | undefined,
): Promise<Record<string, unknown>> {
  if (profile !== "supabase") return {};
  const supabase = await loadOldSupabaseIntegration();
  return {
    filter: supabase.filter,
    serialize: supabase.serialize,
    skipDefaultPrivilegeSubtraction: true,
  };
}

export function createPool(
  connectionString: string,
  options?: { setRolePostgres?: boolean },
): pg.Pool {
  const pool = new pg.Pool({ connectionString, max: 5 });
  pool.on("error", () => {});
  if (options?.setRolePostgres) {
    pool.on("connect", (client) => {
      void client.query("SET ROLE postgres").catch(() => {});
    });
  }
  return pool;
}

function joinStatements(statements: string[]): string {
  return statements.join("\n\n");
}

function writeUnifiedDiff(
  oldSql: string,
  newSql: string,
  outPath: string,
): void {
  const oldFile = join(tmpdir(), `pgdelta-compare-old-${process.pid}.sql`);
  const newFile = join(tmpdir(), `pgdelta-compare-new-${process.pid}.sql`);
  try {
    writeFileSync(oldFile, oldSql, "utf8");
    writeFileSync(newFile, newSql, "utf8");
    try {
      const diffOut = execSync(`diff -u "${oldFile}" "${newFile}"`, {
        encoding: "utf8",
      });
      writeFileSync(outPath, diffOut, "utf8");
    } catch (err) {
      const stdout =
        typeof err === "object" &&
        err !== null &&
        "stdout" in err &&
        typeof (err as { stdout: unknown }).stdout === "string"
          ? (err as { stdout: string }).stdout
          : "";
      writeFileSync(outPath, stdout || "(no diff output)\n", "utf8");
    }
  } finally {
    try {
      execSync(`rm -f "${oldFile}" "${newFile}"`);
    } catch {
      // ignore cleanup failures
    }
  }
}

function deltaKind(delta: ReturnType<typeof diff>[number]): string {
  if (delta.verb === "add" || delta.verb === "remove")
    return delta.fact.id.kind;
  if (delta.verb === "set") return delta.id.kind;
  if (delta.verb === "link" || delta.verb === "unlink")
    return delta.edge.from.kind;
  return "unknown";
}

async function adjudicateApplyCheck(
  desiredPool: Pool,
  oldPlan: OldPlan | null,
  newPlan: Plan,
  desiredFactBase: FactBase,
  planOptions: PlanOptions,
  extractFn: typeof extract,
  sourceDb: { clone(): Promise<{ pool: Pool; drop(): Promise<void> }> },
): Promise<NonNullable<CompareMetrics["applyCheck"]>> {
  const cloneNew = await sourceDb.clone();
  const cloneOld = await sourceDb.clone();

  let newConverges = false;
  let oldConverges = false;
  let oldAclDriftOnly = false;
  let oldFingerprintGated = false;
  const notes: string[] = [];

  // Convergence is judged through the SAME profile-scoped lens used to build the
  // plan: re-extract with the profile extractor and re-plan against the desired
  // factbase. Zero residual actions means the source now matches desired within
  // scope — managed `auth.*` / `storage.*` objects are projected out, so a raw
  // catalog/hash comparison (which sees them as drift) would always report a
  // spurious mismatch. Mirrors tests/dbdev-roundtrip.test.ts.
  const residualActions = (afterFactBase: FactBase): Plan["actions"] =>
    plan(afterFactBase, desiredFactBase, { compact: false, ...planOptions })
      .actions;

  try {
    try {
      const applyResult = await apply(newPlan, cloneNew.pool, {
        fingerprintGate: false,
      });
      if (applyResult.status !== "applied") {
        notes.push(
          `new apply failed: ${applyResult.error?.message ?? applyResult.status}`,
        );
      } else {
        const after = await extractFn(cloneNew.pool);
        const residual = residualActions(after.factBase);
        newConverges = residual.length === 0;
        if (!newConverges) {
          notes.push(
            `new residual ${residual.length} action(s): ${residual
              .slice(0, 5)
              .map((a) => a.sql)
              .join(" | ")}`,
          );
        }
      }
    } catch (err) {
      notes.push(`new: ${err instanceof Error ? err.message : String(err)}`);
    }

    try {
      if (oldPlan === null) {
        const after = await extractFn(cloneOld.pool);
        const residual = residualActions(after.factBase);
        oldConverges = residual.length === 0;
        if (!oldConverges)
          notes.push(`oldCreatePlan null but ${residual.length} residual`);
      } else {
        const applyOld = await oldApplyPlan(
          oldPlan,
          cloneOld.pool,
          desiredPool,
          { verifyPostApply: false },
        );
        if (
          applyOld.status !== "applied" &&
          applyOld.status !== "already_applied"
        ) {
          if (applyOld.status === "fingerprint_mismatch")
            oldFingerprintGated = true;
          notes.push(`old apply status=${applyOld.status}`);
        } else {
          const after = await extractFn(cloneOld.pool);
          const residual = residualActions(after.factBase);
          if (residual.length === 0) {
            oldConverges = true;
          } else {
            const driftDeltas = diff(after.factBase, desiredFactBase);
            const allAcl =
              driftDeltas.length > 0 &&
              driftDeltas.every((d) => deltaKind(d) === "acl");
            if (allAcl) oldAclDriftOnly = true;
            notes.push(
              `old ${residual.length} residual action(s)${allAcl ? " (all acl drift)" : ""}`,
            );
          }
        }
      }
    } catch (err) {
      notes.push(`old: ${err instanceof Error ? err.message : String(err)}`);
    }
  } finally {
    await Promise.all([cloneNew.drop(), cloneOld.drop()]);
  }

  const bucket = decideConvergenceBucket({
    newConverges,
    oldConverges,
    oldAclDriftOnly,
    oldFingerprintGated,
  });

  return {
    bucket,
    oldConverges,
    newConverges,
    ...(notes.length > 0 ? { note: notes.join("; ") } : {}),
  };
}

export async function compareEngines(
  sourcePool: Pool,
  desiredPool: Pool,
  options: CompareOptions,
  cloneSource?: { clone(): Promise<{ pool: Pool; drop(): Promise<void> }> },
): Promise<CompareMetrics> {
  const started = performance.now();
  const profile = options.profile ?? "raw";
  const outDir = options.outDir;
  mkdirSync(outDir, { recursive: true });

  const oldOpts = await resolveOldPlanOptions(profile);

  const ctx =
    profile === "raw"
      ? null
      : await resolveCliProfile(sourcePool, profile, {
          restrictToApplier: false,
        });

  const extractSource = ctx?.extract ?? extract;
  const extractDesired = ctx?.extract ?? extract;

  const [sourceState, desiredState] = await Promise.all([
    extractSource(sourcePool),
    extractDesired(desiredPool),
  ]);

  const oldPlanStart = performance.now();
  const oldResult = await oldCreatePlan(sourcePool, desiredPool, oldOpts);
  const oldPlanMs = performance.now() - oldPlanStart;
  const oldStatements = oldResult
    ? flattenOldPlanStatements(oldResult.plan)
    : [];

  // Probe the applier (the source connection's current_user) so the dogfood plan
  // gets the SAME owner-ALTER elision the engine would apply at apply time. A
  // profile that supplies its own capability (ctx.planOptions) still wins. If
  // the probed applier cannot set some owner, plan() fail-fasts here exactly as
  // it would at apply time — captured as newPlanError, not a crashed run.
  const capability = await probeApplierCapability(sourcePool);

  const newPlanStart = performance.now();
  let newPlan: Plan | null = null;
  let newPlanError: string | undefined;
  try {
    newPlan = plan(sourceState.factBase, desiredState.factBase, {
      compact: options.compact !== false,
      capability,
      ...ctx?.planOptions,
    });
  } catch (err) {
    newPlanError = err instanceof Error ? err.message : String(err);
  }
  const newPlanMs = performance.now() - newPlanStart;
  const newStatements = newPlan?.actions.map((a) => a.sql) ?? [];

  const oldSql = joinStatements(oldStatements);
  const newSql = joinStatements(newStatements);

  writeFileSync(join(outDir, "old.sql"), oldSql, "utf8");
  writeFileSync(join(outDir, "new.sql"), newSql, "utf8");
  if (newPlan !== null) {
    writeFileSync(
      join(outDir, "new-plan.json"),
      serializePlan(newPlan),
      "utf8",
    );
  }
  if (newPlanError !== undefined) {
    writeFileSync(join(outDir, "new-plan-error.txt"), newPlanError, "utf8");
  }
  writeUnifiedDiff(oldSql, newSql, join(outDir, "sql.diff"));

  const metrics: CompareMetrics = {
    scenario: options.scenario,
    profile,
    old: {
      statementCount: oldStatements.length,
      charCount: oldSql.length,
      planMs: oldPlanMs,
      statements: oldStatements,
      planNull: oldResult === null,
    },
    new: {
      statementCount: newStatements.length,
      charCount: newSql.length,
      planMs: newPlanMs,
      actionCount: newPlan?.actions.length ?? 0,
      filteredDeltaCount: newPlan?.filteredDeltas.length ?? 0,
      renameCandidateCount: newPlan?.renameCandidates.length ?? 0,
      ...(newPlan?.safetyReport !== undefined
        ? { safetyReport: newPlan.safetyReport }
        : {}),
      ...(newPlanError !== undefined ? { planError: newPlanError } : {}),
    },
    timing: {
      oldPlanMs,
      newPlanMs,
      totalMs: performance.now() - started,
    },
  };

  if (options.prove && cloneSource && newPlan !== null) {
    const proveStart = performance.now();
    const clone = await cloneSource.clone();
    try {
      const verdict = await provePlan(
        newPlan,
        clone.pool,
        desiredState.factBase,
        ctx?.proveOptions ?? {},
      );
      metrics.prove = {
        ok: verdict.ok,
        proveMs: performance.now() - proveStart,
        tablesChecked: verdict.coverage.tablesChecked,
        tablesSkipped: verdict.coverage.tablesSkipped.length,
        driftDeltaCount: verdict.driftDeltas.length,
      };
      writeFileSync(
        join(outDir, "prove.json"),
        JSON.stringify(verdict, null, 2),
        "utf8",
      );
    } finally {
      await clone.drop();
    }
  }

  if (options.applyCheck && cloneSource && newPlan !== null) {
    const applyCheck = await adjudicateApplyCheck(
      desiredPool,
      oldResult?.plan ?? null,
      newPlan,
      desiredState.factBase,
      { compact: false, ...ctx?.planOptions },
      extractDesired,
      cloneSource,
    );
    metrics.applyCheck = applyCheck;
    writeFileSync(
      join(outDir, "apply-check.json"),
      JSON.stringify(metrics.applyCheck, null, 2),
      "utf8",
    );
  }

  writeFileSync(
    join(outDir, "metrics.json"),
    JSON.stringify(metrics, null, 2),
    "utf8",
  );
  return metrics;
}
