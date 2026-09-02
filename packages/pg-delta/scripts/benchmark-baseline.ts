#!/usr/bin/env bun
/**
 * Baseline benchmark: pg-delta vs `pg_dump --schema-only` for bringing an
 * EMPTY database up to a populated one's schema — the branch-initialisation
 * shape (platform `init_migration` task, which replaced the branching
 * service's dump-and-restore baseline with a pg-delta diff-and-apply).
 *
 * Investigation tooling only: never touches `src/` behavior. Two pipelines are
 * timed against the same source database and a fresh empty target per
 * iteration:
 *
 *   pg_dump path      pg_dump --schema-only <source> → file
 *                     psql -f file <target>                        [--apply]
 *
 *   pg-delta path     construct pools (max = --pool-max, one per side)
 *                     first connect per side
 *                     resolveProfile(targetPool)                  (empty side)
 *                     Promise.all(extract target, extract source) [OVERLAPPING]
 *                     plan({ renames: "off", compact: true, ...profile })
 *                     apply(plan, targetPool)                      [--apply]
 *
 * The pg-delta path is run once per `--concurrency` value so the cost of the
 * platform's serial shape (pool max 1, concurrency 1) is visible next to a
 * fanned-out extraction. Each variant gets its own fresh target.
 *
 * After an applied iteration, BOTH targets are re-extracted and diffed against
 * the source fact base (outside the timed window) and the residual delta count
 * is reported — the fidelity side of the trade-off (what a dump-based baseline
 * silently misses).
 *
 *   bun scripts/benchmark-baseline.ts                    # disposable container, medium fixture
 *   bun scripts/benchmark-baseline.ts --scale large      # 20 schemas x 250 tables
 *   bun scripts/benchmark-baseline.ts --concurrency 1,4,8 --iterations 5
 *   PGDELTA_BENCH_SOURCE_URL=... PGDELTA_BENCH_TARGET_ADMIN_URL=... \
 *     bun scripts/benchmark-baseline.ts                  # existing server, READ-ONLY on source
 *
 * Flags:
 *   --scale small|medium|large   fixture scale (default medium); overridden by
 *   --schemas <n> --tables <n> --cols <n>
 *   --image <docker image>       Postgres image for the disposable container.
 *                                Defaults to postgres:<major>-alpine where
 *                                <major> is the host `pg_dump --version`, so
 *                                the dump runs against a server it supports.
 *   --iterations <n>             measured iterations per pipeline (default 3)
 *   --warmups <n>                unmeasured iterations first (default 1)
 *   --concurrency <a,b,..>       pg-delta extraction concurrency variants
 *                                (default "1,4"; 1 = the platform worker shape)
 *   --pool-max <n>               pool size per side for the pg-delta path
 *                                (default = the variant's concurrency; the
 *                                platform worker uses 1)
 *   --profile supabase|raw       integration profile (default supabase, as the
 *                                platform uses)
 *   --statement-timeout <ms>     extraction/apply statement timeout (default 30000,
 *                                the platform's per-statement budget)
 *   --no-apply                   time extraction + plan / dump only; skip the
 *                                psql restore, pg-delta apply and fidelity check
 *   --pg-dump-args "<args>"      extra args appended to pg_dump (e.g. "--no-owner")
 *   --skip-pg-dump               only run the pg-delta variants
 *   --skip-pg-delta              only run the pg_dump pipeline
 *   --quiet                      suppress the human summary (JSONL still written)
 *
 * Remote mode (env only — never argv, so a shell history never carries
 * credentials): PGDELTA_BENCH_SOURCE_URL is the populated database (READ-ONLY),
 * PGDELTA_BENCH_TARGET_ADMIN_URL is a maintenance database on the server that
 * should host the disposable empty targets (`CREATE DATABASE` privilege
 * required; they are dropped after each iteration). The host `pg_dump`/`psql`
 * major must match the remote server.
 *
 * Artifacts: `.bench-artifacts/baseline-<runId>.jsonl` (gitignored). They carry
 * NO URL, host, user or password — only timings, counts and the run label
 * (PGDELTA_BENCH_RUN_LABEL, optional nonsecret free text).
 *
 * RUNTIME MATTERS. Run it under Node for platform-faithful numbers:
 *
 *   node --experimental-transform-types scripts/benchmark-baseline.ts [flags]
 *
 * Under Bun the apply phase is 3–6× slower than under Node for the SAME plan,
 * and the gap grows with the live heap (retained fact bases): Bun's GC cost per
 * statement round trip scales with heap size, so a harness that keeps several
 * fact bases alive (this one does, for the fidelity check) measures the GC, not
 * pg-delta. See docs/benchmarks/baseline-vs-pg-dump.md for the measurements.
 */
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { apply } from "../src/apply/apply.ts";
import { diff } from "../src/core/diff.ts";
import { hasBlockingDiagnostics } from "../src/frontends/diagnostics.ts";
import type { ExtractResult } from "../src/extract/extract.ts";
import {
  rawProfile,
  type ResolvedProfile,
  resolveProfile,
  supabaseProfile,
} from "../src/integrations/index.ts";
import { plan } from "../src/plan/plan.ts";

// ── options ─────────────────────────────────────────────────────────────────

type Scale = "small" | "medium" | "large";
type ProfileId = "supabase" | "raw";

/** schemas x tables per schema; columns per table are fixed per scale. */
const SCALES: Record<Scale, { schemas: number; tables: number; cols: number }> =
  {
    small: { schemas: 5, tables: 40, cols: 12 },
    medium: { schemas: 10, tables: 100, cols: 12 },
    large: { schemas: 20, tables: 250, cols: 12 },
  };

interface Options {
  scale: Scale;
  schemas: number;
  tables: number;
  cols: number;
  image: string | undefined;
  iterations: number;
  warmups: number;
  concurrency: number[];
  poolMax: number | undefined;
  profile: ProfileId;
  statementTimeoutMs: number;
  apply: boolean;
  pgDumpArgs: string[];
  runPgDump: boolean;
  runPgDelta: boolean;
  quiet: boolean;
}

class UsageError extends Error {}

function parseArgs(argv: string[]): Options {
  const scaleArg = takeFlag(argv, "--scale") ?? "medium";
  if (!(scaleArg in SCALES)) {
    throw new UsageError(`--scale must be small|medium|large, got ${scaleArg}`);
  }
  const scale = scaleArg as Scale;
  const base = SCALES[scale];
  const profile = takeFlag(argv, "--profile") ?? "supabase";
  if (profile !== "supabase" && profile !== "raw") {
    throw new UsageError(`--profile must be supabase|raw, got ${profile}`);
  }
  const concurrency = (takeFlag(argv, "--concurrency") ?? "1,4")
    .split(",")
    .map((s) => Number(s.trim()));
  if (concurrency.some((n) => !Number.isInteger(n) || n < 1)) {
    throw new UsageError(
      `--concurrency must be positive integers, got ${concurrency.join(",")}`,
    );
  }
  const poolMaxRaw = takeFlag(argv, "--pool-max");
  const pgDumpArgsRaw = takeFlag(argv, "--pg-dump-args");
  const options: Options = {
    scale,
    schemas: numberFlag(argv, "--schemas", base.schemas),
    tables: numberFlag(argv, "--tables", base.tables),
    cols: numberFlag(argv, "--cols", base.cols),
    image: takeFlag(argv, "--image"),
    iterations: numberFlag(argv, "--iterations", 3),
    warmups: numberFlag(argv, "--warmups", 1),
    concurrency,
    poolMax: poolMaxRaw === undefined ? undefined : Number(poolMaxRaw),
    profile,
    statementTimeoutMs: numberFlag(argv, "--statement-timeout", 30_000),
    apply: !takeSwitch(argv, "--no-apply"),
    pgDumpArgs:
      pgDumpArgsRaw === undefined
        ? []
        : pgDumpArgsRaw.split(/\s+/).filter(Boolean),
    runPgDump: !takeSwitch(argv, "--skip-pg-dump"),
    runPgDelta: !takeSwitch(argv, "--skip-pg-delta"),
    quiet: takeSwitch(argv, "--quiet"),
  };
  if (argv.length > 0)
    throw new UsageError(`unknown arguments: ${argv.join(" ")}`);
  return options;
}

function takeFlag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  const value = argv[i + 1];
  if (value === undefined) throw new UsageError(`${name} needs a value`);
  argv.splice(i, 2);
  return value;
}

function takeSwitch(argv: string[], name: string): boolean {
  const i = argv.indexOf(name);
  if (i === -1) return false;
  argv.splice(i, 1);
  return true;
}

function numberFlag(argv: string[], name: string, fallback: number): number {
  const raw = takeFlag(argv, name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0)
    throw new UsageError(`${name} must be a number, got ${raw}`);
  return n;
}

// ── fixture ─────────────────────────────────────────────────────────────────

const FIXTURE_ROLES = ["bench_anon", "bench_authenticated"] as const;

/**
 * An application-shaped schema, generated server-side per schema in one DO
 * block: identity PKs, FKs between neighbouring tables, indexes, unique + check
 * constraints, RLS with two policies per table, an updated_at trigger, grants
 * to two roles, comments, an enum, a couple of functions and a view per five
 * tables. Deliberately heavier per table than scripts/stress.ts, which is
 * column-volume oriented — a branch baseline is dominated by object count and
 * dependency edges, not column width.
 */
function schemaDdl(s: number, tables: number, cols: number): string {
  const schema = `bench_${String(s).padStart(3, "0")}`;
  const colDefs: string[] = [];
  for (let c = 0; c < cols; c++) {
    colDefs.push(
      c % 4 === 0
        ? `c${c} text NOT NULL DEFAULT ''''`
        : c % 4 === 1
          ? `c${c} integer DEFAULT 0`
          : c % 4 === 2
            ? `c${c} timestamptz DEFAULT now()`
            : `c${c} numeric(12,2)`,
    );
  }
  return `
    CREATE SCHEMA ${schema};
    CREATE TYPE ${schema}.status AS ENUM ('draft', 'active', 'archived');
    CREATE FUNCTION ${schema}.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN NEW.updated_at := now(); RETURN NEW; END $fn$;
    CREATE FUNCTION ${schema}.is_owner(owner_id uuid) RETURNS boolean LANGUAGE sql STABLE
      AS $fn$ SELECT owner_id = '00000000-0000-0000-0000-000000000000'::uuid $fn$;
    COMMENT ON FUNCTION ${schema}.is_owner(uuid) IS 'row ownership check for ${schema}';
    DO $body$
    DECLARE t int;
    BEGIN
      FOR t IN 0..${tables - 1} LOOP
        EXECUTE format(
          'CREATE TABLE ${schema}.t%1$s (
             id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
             owner_id uuid NOT NULL,
             status ${schema}.status NOT NULL DEFAULT ''draft'',
             updated_at timestamptz NOT NULL DEFAULT now(),
             ${colDefs.join(", ")},
             CONSTRAINT t%1$s_c1_positive CHECK (c1 >= 0),
             CONSTRAINT t%1$s_c0_owner_key UNIQUE (owner_id, c0)
           )', t);
        IF t % 3 = 2 THEN
          EXECUTE format(
            'ALTER TABLE ${schema}.t%1$s ADD COLUMN parent_id bigint
               REFERENCES ${schema}.t%2$s(id) ON DELETE CASCADE', t, t - 1);
          EXECUTE format('CREATE INDEX t%1$s_parent_idx ON ${schema}.t%1$s (parent_id)', t);
        END IF;
        EXECUTE format('CREATE INDEX t%1$s_owner_idx ON ${schema}.t%1$s (owner_id)', t);
        EXECUTE format('CREATE INDEX t%1$s_status_upd_idx ON ${schema}.t%1$s (status, updated_at DESC)', t);
        EXECUTE format('ALTER TABLE ${schema}.t%1$s ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format(
          'CREATE POLICY t%1$s_select ON ${schema}.t%1$s FOR SELECT TO bench_anon, bench_authenticated USING (true)', t);
        EXECUTE format(
          'CREATE POLICY t%1$s_write ON ${schema}.t%1$s FOR ALL TO bench_authenticated
             USING (${schema}.is_owner(owner_id)) WITH CHECK (${schema}.is_owner(owner_id))', t);
        EXECUTE format(
          'CREATE TRIGGER t%1$s_updated_at BEFORE UPDATE ON ${schema}.t%1$s
             FOR EACH ROW EXECUTE FUNCTION ${schema}.set_updated_at()', t);
        EXECUTE format('GRANT SELECT ON ${schema}.t%1$s TO bench_anon', t);
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ${schema}.t%1$s TO bench_authenticated', t);
        EXECUTE format('COMMENT ON TABLE ${schema}.t%1$s IS ''bench table %1$s''', t);
        EXECUTE format('COMMENT ON COLUMN ${schema}.t%1$s.owner_id IS ''owning user''', t);
        IF t % 5 = 0 THEN
          EXECUTE format(
            'CREATE VIEW ${schema}.v%1$s AS SELECT id, owner_id, status, c0 FROM ${schema}.t%1$s WHERE status <> ''archived''', t);
          EXECUTE format('GRANT SELECT ON ${schema}.v%1$s TO bench_anon, bench_authenticated', t);
        END IF;
      END LOOP;
    END
    $body$;
    GRANT USAGE ON SCHEMA ${schema} TO bench_anon, bench_authenticated;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${schema} TO bench_authenticated;
  `;
}

async function loadFixture(pool: pg.Pool, options: Options): Promise<void> {
  const existing = await pool.query<{ rolname: string }>(
    `SELECT rolname FROM pg_roles WHERE rolname = ANY($1)`,
    [FIXTURE_ROLES],
  );
  const have = new Set(existing.rows.map((r) => r.rolname));
  for (const role of FIXTURE_ROLES) {
    if (!have.has(role)) await pool.query(`CREATE ROLE ${role} NOLOGIN`);
  }
  const start = performance.now();
  for (let s = 0; s < options.schemas; s++) {
    await pool.query(schemaDdl(s, options.tables, options.cols));
  }
  log(
    `fixture: ${options.schemas} schemas x ${options.tables} tables x ${options.cols} cols ` +
      `(${options.schemas * options.tables} tables) generated in ${sec(performance.now() - start)}`,
  );
}

// ── measurement ─────────────────────────────────────────────────────────────

const PG_DUMP_PHASES = ["pgDump", "psqlRestore"] as const;
const PG_DELTA_PHASES = [
  "poolConstruct",
  "targetFirstConnect",
  "sourceFirstConnect",
  "profileResolve",
  "extractInterval",
  "extractTarget",
  "extractSource",
  "plan",
  "applyGate",
  "applyExecute",
  "poolShutdown",
] as const;

interface IterationRecord {
  pipeline: string;
  iteration: number;
  warmup: boolean;
  totalMs: number;
  phases: Record<string, number>;
  counts: Record<string, number>;
}

/** Wall-clock the given step and store it under `phases[name]`. */
async function phase<T>(
  phases: Record<string, number>,
  name: string,
  fn: () => Promise<T> | T,
): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    phases[name] = (phases[name] ?? 0) + (performance.now() - start);
  }
}

// ── pg_dump pipeline ────────────────────────────────────────────────────────

async function runProcess(
  cmd: string[],
): Promise<{ ms: number; stderr: string }> {
  const start = performance.now();
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd[0]!, cmd.slice(1), {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      const ms = performance.now() - start;
      if (code !== 0) {
        reject(
          new Error(
            `${cmd[0]} exited ${code}:\n${stderr.trim().slice(0, 2000)}`,
          ),
        );
        return;
      }
      resolve({ ms, stderr });
    });
  });
}

async function pgDumpIteration(
  ctx: RunContext,
  targetUri: string,
  iteration: number,
  warmup: boolean,
): Promise<IterationRecord> {
  const phases: Record<string, number> = {};
  const counts: Record<string, number> = {};
  const dumpFile = join(ctx.tmpDir, `dump-${iteration}.sql`);
  const start = performance.now();

  await phase(phases, "pgDump", () =>
    runProcess([
      "pg_dump",
      "--schema-only",
      ...ctx.options.pgDumpArgs,
      "-f",
      dumpFile,
      ctx.sourceUri,
    ]),
  );
  counts["dumpBytes"] = statSync(dumpFile).size;

  if (ctx.options.apply) {
    await phase(phases, "psqlRestore", () =>
      runProcess([
        "psql",
        "-X",
        "-q",
        "-v",
        "ON_ERROR_STOP=1",
        "-f",
        dumpFile,
        targetUri,
      ]),
    );
  }
  const totalMs = performance.now() - start;
  rmSync(dumpFile, { force: true });
  return { pipeline: "pg_dump", iteration, warmup, totalMs, phases, counts };
}

// ── pg-delta pipeline ───────────────────────────────────────────────────────

function makePool(uri: string, max: number, appName: string): pg.Pool {
  const pool = new pg.Pool({
    connectionString: uri,
    max,
    application_name: appName,
  });
  pool.on("error", () => {});
  return pool;
}

async function pgDeltaIteration(
  ctx: RunContext,
  targetUri: string,
  concurrency: number,
  iteration: number,
  warmup: boolean,
): Promise<IterationRecord> {
  const { options } = ctx;
  const poolMax = options.poolMax ?? concurrency;
  const phases: Record<string, number> = {};
  const counts: Record<string, number> = {};
  const start = performance.now();

  const pools = await phase(phases, "poolConstruct", () => ({
    target: makePool(targetUri, poolMax, "pgdelta-bench-target"),
    source: makePool(ctx.sourceUri, poolMax, "pgdelta-bench-source"),
  }));
  try {
    await phase(phases, "targetFirstConnect", () =>
      pools.target.query("SELECT 1"),
    );
    await phase(phases, "sourceFirstConnect", () =>
      pools.source.query("SELECT 1"),
    );

    // Mirrors the platform worker: the profile resolves against the database
    // being transformed (the empty branch), and the branch is pg-delta's source.
    const profile: ResolvedProfile = await phase(phases, "profileResolve", () =>
      resolveProfile(
        pools.target,
        options.profile === "supabase" ? supabaseProfile : rawProfile,
      ),
    );
    const extractOptions = {
      concurrency,
      statementTimeoutMs: options.statementTimeoutMs,
    };
    const [target, source] = await phase(phases, "extractInterval", () =>
      Promise.all([
        phase(phases, "extractTarget", () =>
          profile.extract(pools.target, extractOptions),
        ),
        phase(phases, "extractSource", () =>
          profile.extract(pools.source, extractOptions),
        ),
      ]),
    );
    counts["sourceFacts"] = source.factBase.facts().length;
    counts["targetFacts"] = target.factBase.facts().length;
    const diagnostics = [...target.diagnostics, ...source.diagnostics];
    if (hasBlockingDiagnostics(diagnostics)) {
      throw new Error(
        `pg-delta blocked: ${diagnostics
          .filter((d) => d.severity === "error")
          .map((d) => d.code)
          .join(", ")}`,
      );
    }

    const migration = await phase(phases, "plan", () =>
      plan(target.factBase, source.factBase, {
        ...profile.planOptions,
        renames: "off",
        compact: true,
      }),
    );
    counts["actions"] = migration.actions.length;
    counts["destructiveActions"] = migration.actions.filter(
      (a) => a.dataLoss === "destructive",
    ).length;

    if (options.apply && migration.actions.length > 0) {
      // apply() re-extracts the target for its fingerprint gate before the
      // first segment starts; the first segmentStart event marks the boundary.
      const applyStart = performance.now();
      let firstSegmentAt: number | undefined;
      let statementMs = 0;
      let segments = 0;
      const report = await apply(migration, pools.target, {
        ...profile.applyOptions,
        statementTimeoutMs: options.statementTimeoutMs,
        onEvent: (event) => {
          if (event.kind === "segmentStart") {
            segments++;
            firstSegmentAt ??= performance.now();
          } else if (event.kind === "actionEnd") {
            statementMs += event.ms;
          }
        },
      });
      const applyEnd = performance.now();
      const gateEnd = firstSegmentAt ?? applyEnd;
      phases["applyGate"] = gateEnd - applyStart;
      phases["applyExecute"] = applyEnd - gateEnd;
      counts["appliedActions"] = report.appliedActions;
      counts["applySegments"] = segments;
      // Sum of per-statement round trips as apply() measured them; the gap to
      // applyExecute is the executor's own overhead between statements.
      counts["applyStatementMs"] = Math.round(statementMs);
      if (report.status !== "applied") {
        throw new Error(
          `pg-delta applied ${report.appliedActions}/${migration.actions.length} actions before failing` +
            (report.error ? `: ${report.error.message}` : ""),
        );
      }
    }
  } finally {
    await phase(phases, "poolShutdown", () =>
      Promise.allSettled([pools.target.end(), pools.source.end()]),
    );
  }
  const totalMs = performance.now() - start;
  return {
    pipeline: `pg-delta c${concurrency} p${poolMax}`,
    iteration,
    warmup,
    totalMs,
    phases,
    counts,
  };
}

// ── fidelity check (outside the timed window) ───────────────────────────────

/** Re-extract the freshly baselined target and count what still differs from
 *  the source. Both extractions are handler-aware under the same profile so a
 *  managed object (pg_cron job, pgmq queue) counts the same way on both sides. */
async function residualDeltas(
  ctx: RunContext,
  targetUri: string,
  source: ExtractResult,
): Promise<number> {
  const pool = makePool(targetUri, 4, "pgdelta-bench-verify");
  try {
    const profile = await resolveProfile(
      pool,
      ctx.options.profile === "supabase" ? supabaseProfile : rawProfile,
    );
    const target = await profile.extract(pool, { concurrency: 4 });
    return diff(target.factBase, source.factBase).length;
  } finally {
    await pool.end();
  }
}

// ── target provisioning ─────────────────────────────────────────────────────

interface TargetProvider {
  /** create a fresh, empty database and return its URI */
  create(): Promise<string>;
  /** drop it again */
  drop(uri: string): Promise<void>;
}

let targetCounter = 0;

function makeTargetProvider(
  adminPool: pg.Pool,
  uriFor: (db: string) => string,
): TargetProvider {
  const names = new Map<string, string>();
  return {
    async create() {
      const name = `bench_target_${process.pid}_${targetCounter++}`;
      await adminPool.query(`CREATE DATABASE "${name}"`);
      const uri = uriFor(name);
      names.set(uri, name);
      return uri;
    },
    async drop(uri) {
      const name = names.get(uri);
      if (name === undefined) return;
      await adminPool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      names.delete(uri);
    },
  };
}

// ── run ─────────────────────────────────────────────────────────────────────

interface RunContext {
  options: Options;
  sourceUri: string;
  tmpDir: string;
}

function log(message: string): void {
  console.log(message);
}

function sec(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function hostPgDumpMajor(): number | undefined {
  const res = spawnSync("pg_dump", ["--version"], { encoding: "utf8" });
  if (res.error || res.status !== 0) return undefined;
  const m = /\b(\d+)\.\d+/.exec(res.stdout);
  return m ? Number(m[1]) : undefined;
}

async function serverMajor(pool: pg.Pool): Promise<number> {
  const res = await pool.query<{ v: number }>(
    `SELECT current_setting('server_version_num')::int AS v`,
  );
  return Math.floor(res.rows[0]!.v / 10000);
}

function printSummary(
  records: IterationRecord[],
  fidelity: Map<string, number[]>,
  options: Options,
): void {
  const measured = records.filter((r) => !r.warmup);
  const pipelines = [...new Set(measured.map((r) => r.pipeline))];
  const width = Math.max(12, ...pipelines.map((p) => p.length));

  log("");
  log(
    `summary (${options.iterations} measured iteration(s) each, median wall time)`,
  );
  log(
    `${"pipeline".padEnd(width)} ${"total".padStart(9)} ${"min".padStart(9)} ${"max".padStart(9)}` +
      (options.apply ? `  ${"residual deltas".padStart(15)}` : ""),
  );
  for (const p of pipelines) {
    const rows = measured.filter((r) => r.pipeline === p);
    const totals = rows.map((r) => r.totalMs);
    const res = fidelity.get(p);
    log(
      `${p.padEnd(width)} ${sec(median(totals)).padStart(9)} ${sec(Math.min(...totals)).padStart(9)} ` +
        `${sec(Math.max(...totals)).padStart(9)}` +
        (options.apply
          ? `  ${(res ? String(median(res)) : "-").padStart(15)}`
          : ""),
    );
  }

  log("");
  log(
    "phase medians (pg-delta's extractTarget/extractSource overlap inside extractInterval — never sum them)",
  );
  for (const p of pipelines) {
    const rows = measured.filter((r) => r.pipeline === p);
    const phaseNames = [...new Set(rows.flatMap((r) => Object.keys(r.phases)))];
    const order: readonly string[] =
      p === "pg_dump" ? PG_DUMP_PHASES : PG_DELTA_PHASES;
    const sorted = phaseNames.sort(
      (a, b) => order.indexOf(a) - order.indexOf(b),
    );
    log(`  ${p}`);
    for (const name of sorted) {
      const ms = median(rows.map((r) => r.phases[name] ?? 0));
      log(`    ${name.padEnd(20)} ${sec(ms).padStart(9)}`);
    }
    const countNames = [...new Set(rows.flatMap((r) => Object.keys(r.counts)))];
    const countLine = countNames
      .map((c) => `${c}=${median(rows.map((r) => r.counts[c] ?? 0))}`)
      .join(" ");
    if (countLine) log(`    ${countLine}`);
  }
}

async function main(argv: string[]): Promise<void> {
  const options = parseArgs([...argv]);
  const runId = randomUUID().slice(0, 8);
  const label = process.env["PGDELTA_BENCH_RUN_LABEL"] ?? "";
  const artifactsDir = join(
    fileURLToPath(new URL("../.bench-artifacts/", import.meta.url)),
  );
  mkdirSync(artifactsDir, { recursive: true });
  const artifact = join(artifactsDir, `baseline-${runId}.jsonl`);
  const tmpDir = mkdtempSync(join(tmpdir(), "pgdelta-bench-"));

  const sourceUrlEnv = process.env["PGDELTA_BENCH_SOURCE_URL"];
  const targetAdminEnv = process.env["PGDELTA_BENCH_TARGET_ADMIN_URL"];

  let sourceUri: string;
  let targets: TargetProvider;
  let cleanup = async (): Promise<void> => {};
  let sourcePool: pg.Pool;

  if (sourceUrlEnv !== undefined) {
    if (targetAdminEnv === undefined) {
      throw new UsageError(
        "PGDELTA_BENCH_SOURCE_URL needs PGDELTA_BENCH_TARGET_ADMIN_URL (where empty targets are created)",
      );
    }
    sourceUri = sourceUrlEnv;
    const adminPool = makePool(targetAdminEnv, 2, "pgdelta-bench-admin");
    const adminUrl = new URL(targetAdminEnv);
    targets = makeTargetProvider(adminPool, (db) => {
      const u = new URL(adminUrl);
      u.pathname = `/${db}`;
      return u.toString();
    });
    sourcePool = makePool(sourceUri, 2, "pgdelta-bench-fixture");
    cleanup = async () => {
      await Promise.allSettled([sourcePool.end(), adminPool.end()]);
    };
    log(`source: remote database (read-only); fixture generation skipped`);
  } else {
    const dumpMajor = hostPgDumpMajor();
    const image =
      options.image ??
      process.env["PGDELTA_TEST_IMAGE"] ??
      (dumpMajor === undefined
        ? "postgres:17-alpine"
        : `postgres:${dumpMajor}-alpine`);
    process.env["PGDELTA_TEST_IMAGE"] = image;
    const { sharedCluster } = await import("../tests/containers.ts");
    const cluster = await sharedCluster();
    const db = await cluster.createDb("bench_source");
    sourceUri = db.uri;
    sourcePool = db.pool;
    targets = makeTargetProvider(cluster.adminPool, cluster.uriFor);
    cleanup = async () => {
      await db.drop();
      await cluster.stop();
    };
    log(`container: ${image}`);
    await loadFixture(sourcePool, options);
  }

  try {
    const dumpMajor = hostPgDumpMajor();
    const srvMajor = await serverMajor(sourcePool);
    log(`server: PG ${srvMajor}; host pg_dump: ${dumpMajor ?? "not found"}`);
    if (
      options.runPgDump &&
      (dumpMajor === undefined || dumpMajor < srvMajor)
    ) {
      throw new UsageError(
        `host pg_dump ${dumpMajor ?? "(missing)"} cannot dump a PG ${srvMajor} server; ` +
          `pass --image postgres:${dumpMajor}-alpine or install a newer pg_dump`,
      );
    }
    const catalog = await sourcePool.query<{
      classes: string;
      attributes: string;
      depends: string;
    }>(
      `SELECT (SELECT count(*) FROM pg_class) AS classes,
              (SELECT count(*) FROM pg_attribute) AS attributes,
              (SELECT count(*) FROM pg_depend) AS depends`,
    );
    log(`catalog: ${JSON.stringify(catalog.rows[0])}`);

    const ctx: RunContext = { options, sourceUri, tmpDir };
    const records: IterationRecord[] = [];
    const fidelity = new Map<string, number[]>();

    // One reference extraction of the source for the fidelity check, taken
    // once — it is compared to each baselined target after the timed window.
    let reference: ExtractResult | undefined;
    if (options.apply) {
      const refPool = makePool(sourceUri, 4, "pgdelta-bench-reference");
      try {
        const profile = await resolveProfile(
          refPool,
          options.profile === "supabase" ? supabaseProfile : rawProfile,
        );
        reference = await profile.extract(refPool, { concurrency: 4 });
      } finally {
        await refPool.end();
      }
    }

    const total = options.warmups + options.iterations;
    type Pipeline = {
      name: string;
      run: (
        targetUri: string,
        i: number,
        warmup: boolean,
      ) => Promise<IterationRecord>;
    };
    const pipelines: Pipeline[] = [];
    if (options.runPgDump) {
      pipelines.push({
        name: "pg_dump",
        run: (t, i, w) => pgDumpIteration(ctx, t, i, w),
      });
    }
    if (options.runPgDelta) {
      for (const c of options.concurrency) {
        pipelines.push({
          name: `pg-delta c${c}`,
          run: (t, i, w) => pgDeltaIteration(ctx, t, c, i, w),
        });
      }
    }

    // Interleave pipelines per iteration so drift (page cache, autovacuum on
    // the catalog) lands on all of them equally.
    for (let i = 0; i < total; i++) {
      const warmup = i < options.warmups;
      for (const pipeline of pipelines) {
        const targetUri = await targets.create();
        try {
          const record = await pipeline.run(targetUri, i, warmup);
          if (options.apply && reference !== undefined && !warmup) {
            const residual = await residualDeltas(ctx, targetUri, reference);
            record.counts["residualDeltas"] = residual;
            const list = fidelity.get(record.pipeline) ?? [];
            list.push(residual);
            fidelity.set(record.pipeline, list);
          }
          records.push(record);
          appendFileSync(
            artifact,
            `${JSON.stringify({
              runId,
              label,
              scale: options.scale,
              schemas: options.schemas,
              tables: options.tables,
              cols: options.cols,
              serverMajor: srvMajor,
              profile: options.profile,
              apply: options.apply,
              ...record,
            })}\n`,
          );
          if (!options.quiet) {
            log(
              `${warmup ? "warmup" : `iter ${i - options.warmups + 1}`}  ${record.pipeline.padEnd(20)} ` +
                `${sec(record.totalMs).padStart(9)}  ` +
                Object.entries(record.phases)
                  .map(([k, v]) => `${k}=${sec(v)}`)
                  .join(" ") +
                (record.counts["residualDeltas"] !== undefined
                  ? `  residualDeltas=${record.counts["residualDeltas"]}`
                  : ""),
            );
          }
        } finally {
          await targets.drop(targetUri);
        }
      }
    }

    if (!options.quiet) printSummary(records, fidelity, options);
    log(`\nartifact: ${artifact}`);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
    await cleanup();
  }
}

// `import.meta.main` is Bun/Node 24+; the argv check covers Node 22
// (`node --experimental-strip-types scripts/benchmark-baseline.ts`).
const isMain =
  (import.meta as { main?: boolean }).main ??
  process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    await main(process.argv.slice(2));
    process.exit(0);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`usage error: ${error.message}`);
      process.exit(2);
    }
    console.error(error);
    process.exit(1);
  }
}
