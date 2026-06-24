#!/usr/bin/env bun
/**
 * Run a curated dogfooding suite: corpus subset + dbdev fixture scenarios.
 *
 * Usage:
 *   bun scripts/run-dogfood-suite.ts [--out-dir <dir>] [--skip-dbdev] [--dbdev-scope core|all]
 *
 * Writes results under docs/dogfooding/runs/<timestamp>/ by default.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bootstrapDbdevFixture } from "./lib/bootstrap-dbdev-fixture.ts";
import { compareEngines } from "./lib/compare-core.ts";
import { resolveRunOutDir } from "./lib/paths.ts";
import { loadCorpus } from "../tests/corpus.ts";
import { sharedCluster, stopAllClusters } from "../tests/containers.ts";

const REPO_ROOT = new URL("../../../", import.meta.url).pathname;

const CORPUS_PICKS = [
  "table-ops--comments",
  "table-ops--empty-table",
  "function-ops--simple-create",
  "type-ops--enum-create",
  "view-operations--simple-create",
];

interface SuiteResult {
  scenario: string;
  kind: "corpus" | "dbdev-fixture";
  metrics: Awaited<ReturnType<typeof compareEngines>>;
}

function parseArgs(argv: string[]): {
  outDir: string;
  skipDbdev: boolean;
  dbdevScope: "core" | "all";
  prove: boolean;
  applyCheck: boolean;
} {
  let outDirArg: string | undefined;
  let skipDbdev = false;
  let dbdevScope: "core" | "all" = "core";
  let prove = false;
  let applyCheck = true;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case "--out-dir":
        outDirArg = next;
        i++;
        break;
      case "--skip-dbdev":
        skipDbdev = true;
        break;
      case "--dbdev-scope":
        if (next !== "core" && next !== "all") {
          throw new Error('--dbdev-scope must be "core" or "all"');
        }
        dbdevScope = next;
        i++;
        break;
      case "--prove":
        prove = true;
        break;
      case "--no-apply-check":
        applyCheck = false;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  const outDir = resolveRunOutDir(
    outDirArg,
    REPO_ROOT,
    join(
      "docs/dogfooding/runs",
      new Date().toISOString().replace(/[:.]/g, "-"),
    ),
  );

  return { outDir, skipDbdev, dbdevScope, prove, applyCheck };
}

async function runCorpusPick(
  name: string,
  outDir: string,
  prove: boolean,
  applyCheck: boolean,
): Promise<SuiteResult> {
  const scenarios = loadCorpus();
  const scenario = scenarios.find((s) => s.name === name);
  if (!scenario) throw new Error(`Missing corpus scenario: ${name}`);

  const cluster = await sharedCluster();
  const source = await cluster.createDb("suite_src");
  const desired = await cluster.createDb("suite_dst");

  try {
    await source.pool.query(scenario.a);
    await desired.pool.query(scenario.b);
    if (scenario.seed) await source.pool.query(scenario.seed);

    const scenarioDir = join(outDir, `corpus-${name.replaceAll("/", "-")}`);
    mkdirSync(scenarioDir, { recursive: true });

    const metrics = await compareEngines(
      source.pool,
      desired.pool,
      {
        scenario: `corpus-${name}`,
        outDir: scenarioDir,
        profile: "raw",
        prove,
        applyCheck,
      },
      source,
    );

    return { scenario: name, kind: "corpus", metrics };
  } finally {
    await Promise.all([source.drop(), desired.drop()]);
  }
}

async function runDbdevScenarios(
  outDir: string,
  scope: "core" | "all",
  prove: boolean,
  applyCheck: boolean,
): Promise<SuiteResult[]> {
  const fixture = await bootstrapDbdevFixture(scope);
  const results: SuiteResult[] = [];

  try {
    const scenarios = [
      {
        name:
          scope === "core"
            ? "dbdev-fixture-core-roundtrip"
            : "dbdev-fixture-declarative-roundtrip",
        source: fixture.mainPool,
        desired: fixture.branchPool,
        cloneSource: fixture.mainCloneSource,
      },
      {
        name: "dbdev-fixture-zero-diff",
        source: fixture.branchPool,
        desired: fixture.branchPool,
        cloneSource: fixture.branchCloneSource,
      },
    ];

    for (const sc of scenarios) {
      const scenarioDir = join(outDir, sc.name);
      mkdirSync(scenarioDir, { recursive: true });
      const metrics = await compareEngines(
        sc.source,
        sc.desired,
        {
          scenario: sc.name,
          outDir: scenarioDir,
          profile: "supabase",
          prove,
          applyCheck,
        },
        sc.cloneSource,
      );
      results.push({ scenario: sc.name, kind: "dbdev-fixture", metrics });
    }
  } finally {
    await fixture.cleanup();
  }

  return results;
}

async function main(): Promise<void> {
  const { outDir, skipDbdev, dbdevScope, prove, applyCheck } = parseArgs(
    process.argv.slice(2),
  );
  mkdirSync(outDir, { recursive: true });

  process.stderr.write(`[run-dogfood-suite] output → ${outDir}\n`);

  const results: SuiteResult[] = [];

  try {
    for (const name of CORPUS_PICKS) {
      process.stderr.write(`[run-dogfood-suite] corpus: ${name}\n`);
      results.push(await runCorpusPick(name, outDir, prove, applyCheck));
    }

    if (!skipDbdev) {
      process.stderr.write(
        `[run-dogfood-suite] dbdev fixture (${dbdevScope})\n`,
      );
      results.push(
        ...(await runDbdevScenarios(outDir, dbdevScope, prove, applyCheck)),
      );
    }
  } finally {
    // The corpus picks use the shared-cluster singleton, which withDb-style
    // teardown never stops; reclaim it so a dogfood run leaks no containers.
    await stopAllClusters();
  }

  const summary = results.map((r) => ({
    scenario: r.scenario,
    kind: r.kind,
    oldStatements: r.metrics.old.statementCount,
    newStatements: r.metrics.new.statementCount,
    oldPlanMs: r.metrics.old.planMs,
    newPlanMs: r.metrics.new.planMs,
    applyBucket: r.metrics.applyCheck?.bucket,
    proveOk: r.metrics.prove?.ok,
  }));

  writeFileSync(
    join(outDir, "suite-summary.json"),
    JSON.stringify(summary, null, 2),
  );

  process.stderr.write("\n━━━━━━━━ run-dogfood-suite summary ━━━━━━━━\n");
  for (const row of summary) {
    process.stderr.write(
      `  ${row.scenario}: old=${row.oldStatements} new=${row.newStatements} apply=${row.applyBucket ?? "n/a"}\n`,
    );
  }
  process.stderr.write("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

await main();
