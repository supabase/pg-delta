#!/usr/bin/env bun
/**
 * Compare pg-delta (old) vs pg-delta-next (new) on the same source/desired pair.
 *
 * Usage:
 *   bun scripts/compare-engines.ts --source <url> --desired <url> --scenario <name> --out-dir <dir>
 *     [--profile supabase] [--no-compact] [--prove] [--apply-check]
 *
 *   bun scripts/compare-engines.ts --fixture dbdev --scenario dbdev-fixture-zero-diff --out-dir /tmp/compare
 *     [--migrations core|all] [--profile supabase] [--prove] [--apply-check]
 *
 *   bun scripts/compare-engines.ts --corpus table-ops/add-column --scenario corpus-add-column --out-dir /tmp/compare
 *
 * Exit: 0 on success, 1 on failure, 2 on usage error.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  bootstrapDbdevFixture,
  type DbdevMigrationScope,
} from "./lib/bootstrap-dbdev-fixture.ts";
import { compareEngines, createPool } from "./lib/compare-core.ts";
import { loadCorpus } from "../tests/corpus.ts";
import { sharedCluster } from "../tests/containers.ts";

const USAGE = `
compare-engines — old vs new pg-delta plan comparison

Usage:
  bun scripts/compare-engines.ts --source <pg-url> --desired <pg-url> \\
    --scenario <name> --out-dir <dir> [options]

  bun scripts/compare-engines.ts --fixture dbdev \\
    --scenario <name> --out-dir <dir> [options]

  bun scripts/compare-engines.ts --corpus <scenario-name> \\
    --scenario <name> --out-dir <dir> [options]

Options:
  --profile raw|supabase     Integration profile (default: raw; dbdev uses supabase)
  --no-compact               Disable CREATE TABLE compaction (new engine)
  --prove                    Run provePlan on new engine (requires cloneable source)
  --apply-check              Apply both plans on clones and check convergence
  --migrations core|all      For --fixture dbdev (default: all)
  --set-role-postgres        SET ROLE postgres on connect (default for supabase fixture)

Examples:
  bun scripts/compare-engines.ts \\
    --source postgresql://postgres:postgres@127.0.0.1:54322/postgres \\
    --desired postgresql://postgres:postgres@127.0.0.1:54322/postgres \\
    --scenario bookmark-zero-diff --out-dir /tmp/compare-bookmark \\
    --profile supabase

  bun scripts/compare-engines.ts --fixture dbdev \\
    --scenario dbdev-fixture-declarative-roundtrip \\
    --out-dir /tmp/compare-dbdev --profile supabase --prove --apply-check
`.trim();

interface ParsedArgs {
  source?: string;
  desired?: string;
  fixture?: string;
  corpus?: string;
  scenario: string;
  outDir: string;
  profile?: string;
  noCompact: boolean;
  prove: boolean;
  applyCheck: boolean;
  migrations: DbdevMigrationScope;
  setRolePostgres: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {
    scenario: "",
    outDir: "",
    noCompact: false,
    prove: false,
    applyCheck: false,
    migrations: "all",
    setRolePostgres: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case "--source":
        if (next === undefined) throw new Error("--source requires a value");
        result.source = next;
        i++;
        break;
      case "--desired":
        if (next === undefined) throw new Error("--desired requires a value");
        result.desired = next;
        i++;
        break;
      case "--fixture":
        if (next === undefined) throw new Error("--fixture requires a value");
        result.fixture = next;
        i++;
        break;
      case "--corpus":
        if (next === undefined) throw new Error("--corpus requires a value");
        result.corpus = next;
        i++;
        break;
      case "--scenario":
        if (next === undefined) throw new Error("--scenario requires a value");
        result.scenario = next;
        i++;
        break;
      case "--out-dir":
        if (next === undefined) throw new Error("--out-dir requires a value");
        result.outDir = next;
        i++;
        break;
      case "--profile":
        if (next === undefined) throw new Error("--profile requires a value");
        result.profile = next;
        i++;
        break;
      case "--migrations":
        if (next !== "core" && next !== "all") {
          throw new Error('--migrations must be "core" or "all"');
        }
        result.migrations = next;
        i++;
        break;
      case "--no-compact":
        result.noCompact = true;
        break;
      case "--prove":
        result.prove = true;
        break;
      case "--apply-check":
        result.applyCheck = true;
        break;
      case "--set-role-postgres":
        result.setRolePostgres = true;
        break;
      case "--help":
      case "-h":
        console.log(USAGE);
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!result.scenario || !result.outDir) {
    throw new Error("--scenario and --out-dir are required");
  }

  const modes = [result.source, result.fixture, result.corpus].filter(Boolean);
  if (modes.length === 0 && !(result.source && result.desired)) {
    if (!result.fixture && !result.corpus) {
      throw new Error("Provide --source/--desired, --fixture, or --corpus");
    }
  }
  if (result.source && !result.desired) {
    throw new Error("--desired is required when --source is set");
  }
  if (result.desired && !result.source) {
    throw new Error("--source is required when --desired is set");
  }

  return result;
}

function printSummary(
  metrics: Awaited<ReturnType<typeof compareEngines>>,
): void {
  process.stderr.write("\n━━━━━━━━ compare-engines summary ━━━━━━━━\n");
  process.stderr.write(`  scenario : ${metrics.scenario}\n`);
  process.stderr.write(`  profile  : ${metrics.profile}\n`);
  process.stderr.write(
    `  old      : ${metrics.old.statementCount} stmt(s), ${metrics.old.planMs.toFixed(0)} ms\n`,
  );
  process.stderr.write(
    `  new      : ${metrics.new.statementCount} stmt(s), ${metrics.new.planMs.toFixed(0)} ms`,
  );
  if (metrics.new.safetyReport) {
    process.stderr.write(
      `, safety=${JSON.stringify(metrics.new.safetyReport)}`,
    );
  }
  process.stderr.write("\n");
  if (metrics.prove) {
    process.stderr.write(
      `  prove    : ${metrics.prove.ok ? "PASS" : "FAIL"} (${metrics.prove.proveMs.toFixed(0)} ms, ${metrics.prove.driftDeltaCount} drift)\n`,
    );
  }
  if (metrics.applyCheck) {
    process.stderr.write(
      `  apply    : ${metrics.applyCheck.bucket}${metrics.applyCheck.note ? ` — ${metrics.applyCheck.note}` : ""}\n`,
    );
  }
  process.stderr.write("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n");
}

async function runCorpusScenario(
  corpusName: string,
  args: ParsedArgs,
): Promise<void> {
  const scenarios = loadCorpus();
  const scenario = scenarios.find((s) => s.name === corpusName);
  if (!scenario) {
    throw new Error(`Corpus scenario not found: ${corpusName}`);
  }
  if (scenario.meta.isolatedCluster) {
    throw new Error(
      `Corpus scenario ${corpusName} requires isolatedCluster — not supported by compare-engines yet`,
    );
  }

  const cluster = await sharedCluster();
  const source = await cluster.createDb("cmp_src");
  const desired = await cluster.createDb("cmp_dst");

  try {
    await source.pool.query(scenario.a);
    await desired.pool.query(scenario.b);
    if (scenario.seed) await source.pool.query(scenario.seed);

    const outDir = join(args.outDir, args.scenario);
    mkdirSync(outDir, { recursive: true });

    const compareOpts = {
      scenario: args.scenario,
      outDir,
      compact: !args.noCompact,
      prove: args.prove,
      applyCheck: args.applyCheck,
      ...(args.profile !== undefined ? { profile: args.profile } : {}),
    };

    const metrics = await compareEngines(
      source.pool,
      desired.pool,
      compareOpts,
      source,
    );

    printSummary(metrics);
  } finally {
    await Promise.all([source.drop(), desired.drop()]);
  }
}

async function runDbdevFixture(args: ParsedArgs): Promise<void> {
  if (args.fixture !== "dbdev") {
    throw new Error(`Unknown fixture: ${args.fixture}`);
  }

  const profile = args.profile ?? "supabase";
  const fixture = await bootstrapDbdevFixture(args.migrations);

  try {
    const isZeroDiff = args.scenario.includes("zero-diff");
    const sourcePool = isZeroDiff ? fixture.branchPool : fixture.mainPool;
    const desiredPool = fixture.branchPool;
    const cloneSource = isZeroDiff
      ? fixture.branchCloneSource
      : fixture.mainCloneSource;

    const outDir = join(args.outDir, args.scenario);
    mkdirSync(outDir, { recursive: true });

    // For roundtrip: source=main (base only), desired=branch (base+dbdev)
    const metrics = await compareEngines(
      sourcePool,
      desiredPool,
      {
        scenario: args.scenario,
        outDir,
        profile,
        compact: !args.noCompact,
        prove: args.prove,
        applyCheck: args.applyCheck,
        setRolePostgres: true,
      },
      cloneSource,
    );

    printSummary(metrics);
  } finally {
    await fixture.cleanup();
  }
}

async function runUrlPair(args: ParsedArgs): Promise<void> {
  const setRole = args.setRolePostgres || args.profile === "supabase";
  const sourcePool = createPool(args.source!, { setRolePostgres: setRole });
  const desiredPool = createPool(args.desired!, { setRolePostgres: setRole });

  try {
    const outDir = join(args.outDir, args.scenario);
    mkdirSync(outDir, { recursive: true });

    const metrics = await compareEngines(sourcePool, desiredPool, {
      scenario: args.scenario,
      outDir,
      compact: !args.noCompact,
      prove: args.prove,
      applyCheck: args.applyCheck,
      setRolePostgres: setRole,
      ...(args.profile !== undefined ? { profile: args.profile } : {}),
    });

    printSummary(metrics);
  } finally {
    await Promise.all([sourcePool.end(), desiredPool.end()]);
  }
}

async function main(): Promise<void> {
  let args: ParsedArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(
      `${err instanceof Error ? err.message : String(err)}\n\n${USAGE}\n`,
    );
    process.exit(2);
  }

  try {
    if (args.corpus) {
      await runCorpusScenario(args.corpus, args);
    } else if (args.fixture) {
      await runDbdevFixture(args);
    } else {
      await runUrlPair(args);
    }
  } catch (err) {
    process.stderr.write(
      `compare-engines failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    if (err instanceof Error && err.stack)
      process.stderr.write(`${err.stack}\n`);
    process.exit(1);
  }
}

await main();
