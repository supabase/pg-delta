#!/usr/bin/env bun
/**
 * Baseline benchmark: pg-delta vs `pg_dump --schema-only` for bringing an
 * EMPTY database up to a populated one's schema — the branch-initialisation
 * shape (platform `init_migration` task, which replaced the branching
 * service's dump-and-restore baseline with a pg-delta diff-and-apply).
 *
 * Investigation tooling only: never touches `src/` behavior. Every pipeline is
 * timed against the same source database and a fresh empty target per
 * iteration, and every connection goes through a per-side latency proxy
 * (scripts/lib/latency-proxy.ts) that injects a configurable RTT and counts
 * protocol round trips — so a loopback container reproduces the cross-region
 * topology the platform runs in, and the round-trip count per phase is exact.
 *
 *   pg_dump pipelines (--restore)
 *     psql     pg_dump --schema-only → file → psql -f          (one round trip per statement)
 *     batch    pg_dump --schema-only → file → ONE multi-statement query
 *              (the legacy branching service's pgx-batch shape; psql
 *              meta-commands such as \restrict are stripped first)
 *
 *   pg-delta pipelines (--variants), each: pools → resolveProfile(target) →
 *   Promise.all(extract target, extract source) → plan({ renames: "off",
 *   compact: true }) → apply
 *     worker   pool max 1, concurrency 1, fingerprint gate ON — the platform
 *              worker's exact shape (worker/src/lib/pg-delta.ts)
 *     tuned    pool max 5, concurrency 4, fingerprint gate OFF — the proposed
 *              platform-side change (what mgmt-api already does)
 *     batched  as `tuned`, but apply sends each transactional segment as ONE
 *              multi-statement query instead of one round trip per action —
 *              a harness-side prototype of the proposed engine change; its
 *              residual-delta count shows whether the result is the same
 *
 * After an applied iteration every target is re-extracted (directly, not via
 * the proxy) and diffed against the source; `residual deltas` is that count.
 *
 *   node --experimental-transform-types scripts/benchmark-baseline.ts [flags]
 *
 * Flags:
 *   --scale small|medium|large   fixture scale (default medium); overridden by
 *   --schemas <n> --tables <n> --cols <n>
 *   --rtt <a,b,..>               round-trip times to inject, ms (default "0").
 *                                Each value gets its own pass over all pipelines.
 *   --variants <list>            pg-delta variants (default "worker,tuned,batched")
 *   --concurrency <a,b,..>       extra custom pg-delta variants `c<N>`: pool N,
 *                                concurrency N, gate on
 *   --restore <list>             pg_dump restore modes (default "psql,batch")
 *   --image <docker image>       Postgres image for the disposable container.
 *                                Defaults to postgres:<major>-alpine where
 *                                <major> is the host `pg_dump --version`.
 *   --iterations <n>             measured iterations per pipeline (default 3)
 *   --warmups <n>                unmeasured iterations first (default 1)
 *   --profile supabase|raw       integration profile (default supabase)
 *   --statement-timeout <ms>     extraction/apply statement timeout (default
 *                                30000, the platform's per-statement budget)
 *   --no-apply                   time extraction + plan / dump only
 *   --pg-dump-args "<args>"      extra args appended to pg_dump
 *   --skip-pg-dump / --skip-pg-delta
 *   --quiet                      suppress the human summary (JSONL still written)
 *
 * Remote mode (env only — never argv, so a shell history never carries
 * credentials): PGDELTA_BENCH_SOURCE_URL is the populated database (READ-ONLY),
 * PGDELTA_BENCH_TARGET_ADMIN_URL a maintenance database on the server that
 * hosts the disposable empty targets (`CREATE DATABASE` privilege required).
 * The proxies still sit in front of both, so `--rtt` adds to the real link.
 *
 * Artifacts: `.bench-artifacts/baseline-<runId>.jsonl` (gitignored). They carry
 * NO URL, host, user or password — only timings, counts and the run label
 * (PGDELTA_BENCH_RUN_LABEL, optional nonsecret free text).
 *
 * RUNTIME MATTERS. Run it under Node for platform-faithful numbers. Under Bun
 * the apply phase is 3–6× slower than under Node for the SAME plan, and the
 * gap grows with the live heap: Bun's GC cost per statement round trip scales
 * with heap size, so a harness that keeps several fact bases alive (this one
 * does) measures the GC, not pg-delta. See docs/benchmarks/baseline-vs-pg-dump.md.
 */
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { buildApplyPreamble } from "../src/apply/apply-preamble.ts";
import { apply, segmentActions } from "../src/apply/apply.ts";
import { diff } from "../src/core/diff.ts";
import { hasBlockingDiagnostics } from "../src/frontends/diagnostics.ts";
import type { ExtractResult } from "../src/extract/extract.ts";
import {
  rawProfile,
  type ResolvedProfile,
  resolveProfile,
  supabaseProfile,
} from "../src/integrations/index.ts";
import { plan, type Plan } from "../src/plan/plan.ts";
import {
  type LatencyProxy,
  startLatencyProxy,
  upstreamOf,
  viaProxy,
} from "./lib/latency-proxy.ts";

// ── options ─────────────────────────────────────────────────────────────────

type Scale = "small" | "medium" | "large";
type ProfileId = "supabase" | "raw";
type RestoreMode = "psql" | "batch";

/** schemas x tables per schema; columns per table are fixed per scale. */
const SCALES: Record<Scale, { schemas: number; tables: number; cols: number }> =
  {
    small: { schemas: 5, tables: 40, cols: 12 },
    medium: { schemas: 10, tables: 100, cols: 12 },
    large: { schemas: 20, tables: 250, cols: 12 },
  };

interface DeltaVariant {
  name: string;
  poolMax: number;
  concurrency: number;
  fingerprintGate: boolean;
  /** send each transactional segment as one multi-statement query */
  batchedApply: boolean;
}

const NAMED_VARIANTS: Record<string, DeltaVariant> = {
  worker: {
    name: "worker",
    poolMax: 1,
    concurrency: 1,
    fingerprintGate: true,
    batchedApply: false,
  },
  tuned: {
    name: "tuned",
    poolMax: 5,
    concurrency: 4,
    fingerprintGate: false,
    batchedApply: false,
  },
  batched: {
    name: "batched",
    poolMax: 5,
    concurrency: 4,
    fingerprintGate: false,
    batchedApply: true,
  },
};

interface Options {
  scale: Scale;
  schemas: number;
  tables: number;
  cols: number;
  rtts: number[];
  variants: DeltaVariant[];
  restores: RestoreMode[];
  image: string | undefined;
  iterations: number;
  warmups: number;
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
  const rtts = numberList(argv, "--rtt", [0]);
  const variants: DeltaVariant[] = [];
  for (const name of listFlag(argv, "--variants", [
    "worker",
    "tuned",
    "batched",
  ])) {
    const v = NAMED_VARIANTS[name];
    if (v === undefined) {
      throw new UsageError(
        `--variants: unknown variant ${name} (known: ${Object.keys(NAMED_VARIANTS).join(", ")})`,
      );
    }
    variants.push(v);
  }
  for (const n of numberList(argv, "--concurrency", [])) {
    if (!Number.isInteger(n) || n < 1) {
      throw new UsageError(`--concurrency must be positive integers, got ${n}`);
    }
    variants.push({
      name: `c${n}`,
      poolMax: n,
      concurrency: n,
      fingerprintGate: true,
      batchedApply: false,
    });
  }
  const restores = listFlag(argv, "--restore", ["psql", "batch"]).map((r) => {
    if (r !== "psql" && r !== "batch") {
      throw new UsageError(`--restore must be psql|batch, got ${r}`);
    }
    return r;
  });
  const pgDumpArgsRaw = takeFlag(argv, "--pg-dump-args");
  const options: Options = {
    scale,
    schemas: numberFlag(argv, "--schemas", base.schemas),
    tables: numberFlag(argv, "--tables", base.tables),
    cols: numberFlag(argv, "--cols", base.cols),
    rtts,
    variants,
    restores,
    image: takeFlag(argv, "--image"),
    iterations: numberFlag(argv, "--iterations", 3),
    warmups: numberFlag(argv, "--warmups", 1),
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

function listFlag(argv: string[], name: string, fallback: string[]): string[] {
  const raw = takeFlag(argv, name);
  if (raw === undefined) return fallback;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function numberList(
  argv: string[],
  name: string,
  fallback: number[],
): number[] {
  const raw = takeFlag(argv, name);
  if (raw === undefined) return fallback;
  return raw.split(",").map((s) => {
    const n = Number(s.trim());
    if (!Number.isFinite(n) || n < 0)
      throw new UsageError(`${name} must be numbers, got ${raw}`);
    return n;
  });
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

const PG_DUMP_PHASES = ["pgDump", "restore"] as const;
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
  rttMs: number;
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

/** Round trips a proxy saw while `fn` ran, stored under `counts[name]`. */
async function countRoundTrips<T>(
  counts: Record<string, number>,
  name: string,
  proxy: LatencyProxy,
  fn: () => Promise<T> | T,
): Promise<T> {
  const before = proxy.snapshot().roundTrips;
  try {
    return await fn();
  } finally {
    counts[name] = (counts[name] ?? 0) + (proxy.snapshot().roundTrips - before);
  }
}

/** Both proxies for one RTT pass: `target` fronts the empty database,
 *  `source` the populated one. Same upstream in container mode; distinct
 *  counters either way. */
interface Link {
  rttMs: number;
  target: LatencyProxy;
  source: LatencyProxy;
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

/**
 * The legacy branching service applied a dump as one pipelined pgx batch:
 * the whole file in one round trip. Emulate with a single multi-statement
 * simple-protocol query. pg_dump's plain output is psql-flavoured — it carries
 * `\restrict` / `\unrestrict` meta-commands on recent minors — so those lines
 * are dropped; everything else is server SQL and runs as written.
 */
async function batchRestore(
  dumpFile: string,
  targetUri: string,
): Promise<{ statements: number }> {
  const sql = readFileSync(dumpFile, "utf8")
    .split("\n")
    .filter((line) => !line.startsWith("\\"))
    .join("\n");
  const client = new pg.Client({ connectionString: targetUri });
  await client.connect();
  try {
    const result = await client.query(sql);
    return { statements: Array.isArray(result) ? result.length : 1 };
  } finally {
    await client.end();
  }
}

async function pgDumpIteration(
  ctx: RunContext,
  link: Link,
  restore: RestoreMode,
  targetUri: string,
  iteration: number,
  warmup: boolean,
): Promise<IterationRecord> {
  const phases: Record<string, number> = {};
  const counts: Record<string, number> = {};
  const dumpFile = join(ctx.tmpDir, `dump-${iteration}.sql`);
  const sourceUri = viaProxy(ctx.sourceUri, link.source);
  const proxiedTarget = viaProxy(targetUri, link.target);
  const start = performance.now();

  await countRoundTrips(counts, "rtDump", link.source, () =>
    phase(phases, "pgDump", () =>
      runProcess([
        "pg_dump",
        "--schema-only",
        ...ctx.options.pgDumpArgs,
        "-f",
        dumpFile,
        sourceUri,
      ]),
    ),
  );
  counts["dumpBytes"] = statSync(dumpFile).size;

  if (ctx.options.apply) {
    await countRoundTrips(counts, "rtRestore", link.target, () =>
      phase(phases, "restore", async () => {
        if (restore === "psql") {
          await runProcess([
            "psql",
            "-X",
            "-q",
            "-v",
            "ON_ERROR_STOP=1",
            "-f",
            dumpFile,
            proxiedTarget,
          ]);
        } else {
          const { statements } = await batchRestore(dumpFile, proxiedTarget);
          counts["restoreStatements"] = statements;
        }
      }),
    );
  }
  const totalMs = performance.now() - start;
  rmSync(dumpFile, { force: true });
  return {
    pipeline: `pg_dump+${restore}`,
    rttMs: link.rttMs,
    iteration,
    warmup,
    totalMs,
    phases,
    counts,
  };
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

/**
 * Prototype of the proposed engine change: one multi-statement query per
 * transactional segment (BEGIN, preamble, every action, COMMIT), so a segment
 * costs one round trip regardless of its action count. Postgres applies
 * `statement_timeout` to each statement of a simple-protocol string
 * separately, so the per-statement budget is preserved. What is lost is
 * per-action failure attribution — the engine change would re-run a failing
 * segment statement by statement to recover it. Non-transactional actions
 * keep their own round trip, as in `apply()`.
 */
async function batchedApply(
  migration: Plan,
  pool: pg.Pool,
  statementTimeoutMs: number,
): Promise<{ segments: number; roundTrips: number }> {
  const segments = segmentActions(migration.actions);
  const client = await pool.connect();
  let roundTrips = 0;
  try {
    for (const segment of segments) {
      const actions = migration.actions
        .slice(segment.start, segment.end)
        .map((a) => a.sql);
      if (segment.transactional) {
        const sql = [
          "BEGIN",
          ...buildApplyPreamble(migration, { statementTimeoutMs }, true),
          ...actions,
          "COMMIT",
        ].join(";\n");
        await client.query(sql);
        roundTrips++;
      } else {
        for (const sql of buildApplyPreamble(
          migration,
          { statementTimeoutMs },
          false,
        )) {
          await client.query(sql);
          roundTrips++;
        }
        await client.query(actions[0]!);
        await client.query("RESET ALL");
        roundTrips += 2;
      }
    }
  } finally {
    client.release();
  }
  return { segments: segments.length, roundTrips };
}

async function pgDeltaIteration(
  ctx: RunContext,
  link: Link,
  variant: DeltaVariant,
  targetUri: string,
  iteration: number,
  warmup: boolean,
): Promise<IterationRecord> {
  const { options } = ctx;
  const phases: Record<string, number> = {};
  const counts: Record<string, number> = {};
  const start = performance.now();

  const pools = await phase(phases, "poolConstruct", () => ({
    target: makePool(
      viaProxy(targetUri, link.target),
      variant.poolMax,
      "pgdelta-bench-target",
    ),
    source: makePool(
      viaProxy(ctx.sourceUri, link.source),
      variant.poolMax,
      "pgdelta-bench-source",
    ),
  }));
  try {
    await countRoundTrips(counts, "rtConnect", link.target, () =>
      phase(phases, "targetFirstConnect", () => pools.target.query("SELECT 1")),
    );
    await countRoundTrips(counts, "rtConnect", link.source, () =>
      phase(phases, "sourceFirstConnect", () => pools.source.query("SELECT 1")),
    );

    // Mirrors the platform worker: the profile resolves against the database
    // being transformed (the empty branch), and the branch is pg-delta's source.
    const profile: ResolvedProfile = await countRoundTrips(
      counts,
      "rtProfile",
      link.target,
      () =>
        phase(phases, "profileResolve", () =>
          resolveProfile(
            pools.target,
            options.profile === "supabase" ? supabaseProfile : rawProfile,
          ),
        ),
    );
    const extractOptions = {
      concurrency: variant.concurrency,
      statementTimeoutMs: options.statementTimeoutMs,
    };
    const [target, source] = await phase(phases, "extractInterval", () =>
      Promise.all([
        countRoundTrips(counts, "rtExtractTarget", link.target, () =>
          phase(phases, "extractTarget", () =>
            profile.extract(pools.target, extractOptions),
          ),
        ),
        countRoundTrips(counts, "rtExtractSource", link.source, () =>
          phase(phases, "extractSource", () =>
            profile.extract(pools.source, extractOptions),
          ),
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
      if (variant.batchedApply) {
        phases["applyGate"] = 0;
        const result = await countRoundTrips(
          counts,
          "rtApply",
          link.target,
          () =>
            phase(phases, "applyExecute", () =>
              batchedApply(migration, pools.target, options.statementTimeoutMs),
            ),
        );
        counts["appliedActions"] = migration.actions.length;
        counts["applySegments"] = result.segments;
      } else {
        // apply() re-extracts the target for its fingerprint gate before the
        // first segment starts; the first segmentStart event marks the boundary.
        const applyStart = performance.now();
        const rtBefore = link.target.snapshot().roundTrips;
        let firstSegmentAt: number | undefined;
        let rtAtFirstSegment: number | undefined;
        let statementMs = 0;
        let segments = 0;
        const report = await apply(migration, pools.target, {
          ...profile.applyOptions,
          fingerprintGate: variant.fingerprintGate,
          statementTimeoutMs: options.statementTimeoutMs,
          onEvent: (event) => {
            if (event.kind === "segmentStart") {
              segments++;
              if (firstSegmentAt === undefined) {
                firstSegmentAt = performance.now();
                rtAtFirstSegment = link.target.snapshot().roundTrips;
              }
            } else if (event.kind === "actionEnd") {
              statementMs += event.ms;
            }
          },
        });
        const applyEnd = performance.now();
        const rtAfter = link.target.snapshot().roundTrips;
        const gateEnd = firstSegmentAt ?? applyEnd;
        const rtGateEnd = rtAtFirstSegment ?? rtAfter;
        phases["applyGate"] = gateEnd - applyStart;
        phases["applyExecute"] = applyEnd - gateEnd;
        counts["rtGate"] = rtGateEnd - rtBefore;
        counts["rtApply"] = rtAfter - rtGateEnd;
        counts["appliedActions"] = report.appliedActions;
        counts["applySegments"] = segments;
        // Sum of per-statement round trips as apply() measured them; the gap
        // to applyExecute is the executor's own overhead between statements.
        counts["applyStatementMs"] = Math.round(statementMs);
        if (report.status !== "applied") {
          throw new Error(
            `pg-delta applied ${report.appliedActions}/${migration.actions.length} actions before failing` +
              (report.error ? `: ${report.error.message}` : ""),
          );
        }
      }
    }
  } finally {
    await phase(phases, "poolShutdown", () =>
      Promise.allSettled([pools.target.end(), pools.source.end()]),
    );
  }
  const totalMs = performance.now() - start;
  return {
    pipeline: `pg-delta ${variant.name}`,
    rttMs: link.rttMs,
    iteration,
    warmup,
    totalMs,
    phases,
    counts,
  };
}

// ── fidelity check (outside the timed window, direct connection) ────────────

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
  /** direct (unproxied) URI of the populated database */
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

/** Round trips a pipeline paid on each side, summed over its `rt*` counters. */
function roundTripTotals(record: IterationRecord): {
  target: number;
  source: number;
} {
  const c = record.counts;
  const target =
    (c["rtRestore"] ?? 0) +
    (c["rtProfile"] ?? 0) +
    (c["rtExtractTarget"] ?? 0) +
    (c["rtGate"] ?? 0) +
    (c["rtApply"] ?? 0);
  const source = (c["rtDump"] ?? 0) + (c["rtExtractSource"] ?? 0);
  // rtConnect is accumulated across both sides; attribute it to neither.
  return { target, source };
}

function printSummary(
  records: IterationRecord[],
  fidelity: Map<string, number[]>,
  options: Options,
): void {
  const measured = records.filter((r) => !r.warmup);
  const keys = [...new Set(measured.map((r) => `${r.rttMs}|${r.pipeline}`))];
  const width = Math.max(
    16,
    ...measured.map(
      (r) => r.pipeline.length + (options.rtts.length > 1 ? 10 : 0),
    ),
  );
  const label = (rtt: number, p: string) =>
    options.rtts.length > 1 ? `${p} @${rtt}ms` : p;

  log("");
  log(
    `summary (${options.iterations} measured iteration(s) each, median wall time; round trips = ReadyForQuery messages seen by the per-side proxy)`,
  );
  log(
    `${"pipeline".padEnd(width)} ${"total".padStart(9)} ${"min".padStart(9)} ${"max".padStart(9)} ${"rt target".padStart(10)} ${"rt source".padStart(10)}` +
      (options.apply ? `  ${"residual deltas".padStart(15)}` : ""),
  );
  for (const key of keys) {
    const [rttStr, p] = key.split("|") as [string, string];
    const rtt = Number(rttStr);
    const rows = measured.filter((r) => r.pipeline === p && r.rttMs === rtt);
    const totals = rows.map((r) => r.totalMs);
    const rt = rows.map(roundTripTotals);
    const res = fidelity.get(key);
    log(
      `${label(rtt, p).padEnd(width)} ${sec(median(totals)).padStart(9)} ${sec(Math.min(...totals)).padStart(9)} ` +
        `${sec(Math.max(...totals)).padStart(9)} ${String(median(rt.map((x) => x.target))).padStart(10)} ` +
        `${String(median(rt.map((x) => x.source))).padStart(10)}` +
        (options.apply
          ? `  ${(res ? String(median(res)) : "-").padStart(15)}`
          : ""),
    );
  }

  log("");
  log(
    "phase medians (pg-delta's extractTarget/extractSource overlap inside extractInterval — never sum them)",
  );
  for (const key of keys) {
    const [rttStr, p] = key.split("|") as [string, string];
    const rtt = Number(rttStr);
    const rows = measured.filter((r) => r.pipeline === p && r.rttMs === rtt);
    const phaseNames = [...new Set(rows.flatMap((r) => Object.keys(r.phases)))];
    const order: readonly string[] = p.startsWith("pg_dump")
      ? PG_DUMP_PHASES
      : PG_DELTA_PHASES;
    const sorted = phaseNames.sort(
      (a, b) => order.indexOf(a) - order.indexOf(b),
    );
    log(`  ${label(rtt, p)}`);
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

async function openLink(
  rttMs: number,
  sourceUri: string,
  targetUriSample: string,
): Promise<Link> {
  const delay = rttMs / 2;
  const [source, target] = await Promise.all([
    startLatencyProxy(upstreamOf(sourceUri), delay),
    startLatencyProxy(upstreamOf(targetUriSample), delay),
  ]);
  return { rttMs, source, target };
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
  /** any URI on the target server, for the proxy's upstream host:port */
  let targetServerUri: string;
  let cleanup = async (): Promise<void> => {};
  let sourcePool: pg.Pool;

  if (sourceUrlEnv !== undefined) {
    if (targetAdminEnv === undefined) {
      throw new UsageError(
        "PGDELTA_BENCH_SOURCE_URL needs PGDELTA_BENCH_TARGET_ADMIN_URL (where empty targets are created)",
      );
    }
    sourceUri = sourceUrlEnv;
    targetServerUri = targetAdminEnv;
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
    targetServerUri = db.uri;
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

    type Pipeline = {
      name: string;
      run: (
        link: Link,
        targetUri: string,
        i: number,
        warmup: boolean,
      ) => Promise<IterationRecord>;
    };
    const pipelines: Pipeline[] = [];
    if (options.runPgDump) {
      for (const restore of options.restores) {
        pipelines.push({
          name: `pg_dump+${restore}`,
          run: (l, t, i, w) => pgDumpIteration(ctx, l, restore, t, i, w),
        });
      }
    }
    if (options.runPgDelta) {
      for (const variant of options.variants) {
        pipelines.push({
          name: `pg-delta ${variant.name}`,
          run: (l, t, i, w) => pgDeltaIteration(ctx, l, variant, t, i, w),
        });
      }
    }

    const total = options.warmups + options.iterations;
    for (const rttMs of options.rtts) {
      const link = await openLink(rttMs, sourceUri, targetServerUri);
      try {
        if (options.rtts.length > 1 || rttMs > 0) {
          log(`\n── injected RTT ${rttMs} ms ──`);
        }
        // Interleave pipelines per iteration so drift (page cache, autovacuum
        // on the catalog) lands on all of them equally.
        for (let i = 0; i < total; i++) {
          const warmup = i < options.warmups;
          for (const pipeline of pipelines) {
            const targetUri = await targets.create();
            try {
              const record = await pipeline.run(link, targetUri, i, warmup);
              if (options.apply && reference !== undefined && !warmup) {
                const residual = await residualDeltas(
                  ctx,
                  targetUri,
                  reference,
                );
                record.counts["residualDeltas"] = residual;
                const key = `${rttMs}|${record.pipeline}`;
                const list = fidelity.get(key) ?? [];
                list.push(residual);
                fidelity.set(key, list);
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
                  runtime: process.versions["bun"] ? "bun" : "node",
                  ...record,
                })}\n`,
              );
              if (!options.quiet) {
                const rt = roundTripTotals(record);
                log(
                  `${warmup ? "warmup" : `iter ${i - options.warmups + 1}`}  ${record.pipeline.padEnd(18)} ` +
                    `${sec(record.totalMs).padStart(9)}  rt=${rt.target}/${rt.source}  ` +
                    Object.entries(record.phases)
                      .filter(([, v]) => v >= 5)
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
      } finally {
        await Promise.all([link.source.close(), link.target.close()]);
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
