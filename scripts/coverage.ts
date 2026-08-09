/**
 * Local coverage runner: runs pg-topo and pg-delta test suites with Istanbul
 * instrumentation (via each package's `BUN_COVERAGE`-aware `run-tests.ts`), then
 * generates a merged report via nyc.
 *
 * Coverage is produced by the `@supabase/bun-istanbul-coverage` preload, which
 * instruments the source globs in `.nycrc.json` and writes per-process JSON to
 * `NYC_OUTPUT_DIR`. nyc then merges every `.nyc_output/*.json` into one report.
 *
 * Usage: bun run coverage [--pg-image postgres:17-alpine] [--unit-only] [--skip-tests]
 *
 * Options:
 *   --pg-image    PostgreSQL image for pg-delta integration + corpus
 *                 (default: engine/container default; forwarded as PGDELTA_TEST_IMAGE)
 *   --unit-only   Skip pg-delta's slow integration + corpus suites; run only
 *                 pg-delta src/ unit tests plus the pg-topo suite. (pg-topo has
 *                 no no-Docker subset, so a Docker daemon is still required.)
 *   --skip-tests  Use existing .nyc_output only; no test runs (report only)
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");
const nycOutputDir = join(repoRoot, ".nyc_output");
const reportDir = join(repoRoot, ".coverage-artifacts");
const pgDeltaRoot = join(repoRoot, "packages", "pg-delta");
const pgTopoRoot = join(repoRoot, "packages", "pg-topo");

function log(msg: string) {
  console.log(`\n=== ${msg} ===`);
}

function fail(msg: string): never {
  console.error(`\nFAIL: ${msg}`);
  process.exit(1);
}

async function run(
  cmd: string[],
  opts: { cwd?: string; env?: Record<string, string> } = {},
): Promise<number> {
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd ?? repoRoot,
    env: { ...process.env, ...opts.env },
    stdout: "inherit",
    stderr: "inherit",
  });
  return proc.exited;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let pgImage: string | undefined;
  let unitOnly = false;
  let skipTests = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--pg-image" && args[i + 1]) {
      pgImage = args[++i];
    } else if (args[i] === "--unit-only") {
      unitOnly = true;
    } else if (args[i] === "--skip-tests") {
      skipTests = true;
    }
  }

  return { pgImage, unitOnly, skipTests };
}

async function main(): Promise<void> {
  const { pgImage, unitOnly, skipTests } = parseArgs();
  const coverageEnv: Record<string, string> = {
    BUN_COVERAGE: "1",
    NYC_OUTPUT_DIR: nycOutputDir,
  };
  const pgDeltaEnv = pgImage
    ? { ...coverageEnv, PGDELTA_TEST_IMAGE: pgImage }
    : coverageEnv;

  log("Options");
  console.log(`  pg-image:   ${pgImage ?? "(engine default)"}`);
  console.log(`  unit-only:  ${unitOnly}`);
  console.log(`  skip-tests: ${skipTests}`);

  if (skipTests) {
    if (!existsSync(nycOutputDir)) {
      fail(
        ".nyc_output does not exist. Run without --skip-tests first to generate coverage data.",
      );
    }
    const files = await readdir(nycOutputDir);
    if (!files.some((f) => f.endsWith(".json"))) {
      fail(".nyc_output has no JSON files. Run without --skip-tests first.");
    }
  } else {
    await rm(nycOutputDir, { recursive: true, force: true });
    await mkdir(nycOutputDir, { recursive: true });

    log("Step 1: pg-topo");
    const topoExit = await run(["bun", "run", "test"], {
      cwd: pgTopoRoot,
      env: coverageEnv,
    });
    if (topoExit !== 0) fail("pg-topo tests failed");

    log("Step 2: pg-delta unit (src/)");
    const unitExit = await run(["bun", "run", "test"], {
      cwd: pgDeltaRoot,
      env: coverageEnv,
    });
    if (unitExit !== 0) fail("pg-delta unit tests failed");

    if (unitOnly) {
      console.log("\n  --unit-only: skipping pg-delta integration + corpus");
    } else {
      log("Step 3: pg-delta integration + corpus (tests/)");
      const integrationExit = await run(["bun", "run", "test:integration"], {
        cwd: pgDeltaRoot,
        env: pgDeltaEnv,
      });
      if (integrationExit !== 0) {
        console.warn(
          "\n  WARNING: pg-delta integration/corpus tests failed — report will reflect partial coverage",
        );
      }
    }
  }

  log("Generating coverage report");
  await rm(reportDir, { recursive: true, force: true });
  const nycExit = await run(["npx", "nyc", "report"], { cwd: repoRoot });
  if (nycExit !== 0) fail("nyc report failed");

  log("RESULT");
  console.log(`Coverage reports: ${reportDir}/`);
  console.log(`  HTML:  open ${reportDir}/index.html`);
  console.log(`  LCOV:  ${reportDir}/lcov.info`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
