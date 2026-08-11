#!/usr/bin/env bun
/**
 * READ-ONLY, production-faithful performance benchmark for diffing two REMOTE
 * PostgreSQL databases. Investigation tooling — it never touches `src/`
 * behavior and never writes to either database.
 *
 * It reproduces the platform management-API pipeline shape per iteration
 * (mirroring `src/cli/commands/plan.ts`, which is the production entry point):
 *
 *   construct pools (max 5, per-side application_name)
 *     → explicit first connect per side (isolates TLS/handshake)
 *     → resolveProfile against the SOURCE pool
 *     → Promise.all(extract source, extract target)      [OVERLAPPING]
 *     → plan({ renames: "off", compact: true, ...profile.planOptions })
 *     → renderPlanFiles
 *     → formatSqlStatements
 *     → end both pools
 *
 * and emits per-phase / per-query timing attribution as JSONL.
 *
 *   PGDELTA_BENCH_SOURCE_URL=... PGDELTA_BENCH_TARGET_URL=... \
 *     bun scripts/benchmark-remote.ts [flags]
 *
 * Flags:
 *   --iterations <n>          measured iterations (default 5)
 *   --warmups <n>             warmup iterations, excluded from stats (default 1)
 *   --reuse-pools             keep pools alive across iterations (warm mode);
 *                             default is fresh pools per iteration (cold, the
 *                             production-faithful shape)
 *   --reverse                 swap the source/target roles without touching env
 *   --profile supabase|raw    integration profile (default supabase)
 *   --statement-timeout <ms>  passthrough to extraction's statementTimeoutMs
 *   --extract-concurrency <n> passthrough to extraction's `concurrency` (default
 *                             1 = serial). >1 fans the catalog families out over
 *                             N connections sharing one exported snapshot — the
 *                             thing this benchmark exists to measure. Still
 *                             READ-ONLY; it just uses more of the pool.
 *   --bytes                   also record approximate per-query result bytes
 *                             (JSON.stringify — adds CPU INSIDE the measured
 *                             extraction interval, so it is off by default)
 *   --quiet                   suppress the human summary (artifacts still written)
 *
 * Connection strings come ONLY from the environment — never argv — so a shell
 * history / process listing never carries credentials:
 *   PGDELTA_BENCH_SOURCE_URL, PGDELTA_BENCH_TARGET_URL,
 *   PGDELTA_BENCH_RUN_LABEL (optional free-text nonsecret label).
 *
 * Artifacts land in `.bench-artifacts/<runId>.jsonl` (gitignored) and carry NO
 * URL, host, user, password, project ref, or user-object SQL: per-query labels
 * are derived from OUR OWN catalog SQL (catalog relation name + a short prefix),
 * exactly like scripts/perf-timing.ts.
 */
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { ExtractResult } from "../src/extract/extract.ts";
import { renderPlanFiles } from "../src/frontends/render-plan-files.ts";
import { formatSqlStatements } from "../src/frontends/sql-format/index.ts";
import {
  rawProfile,
  type ResolvedProfile,
  resolveProfile,
  supabaseProfile,
} from "../src/integrations/index.ts";
import { plan, type PlanOptions } from "../src/plan/plan.ts";

// ── constants ───────────────────────────────────────────────────────────────

/** Pool size the platform worker uses (mirrors src/cli/pool.ts::makePool). */
const POOL_MAX = 5;
/** `SELECT 1` samples per side for the RTT baseline. */
const RTT_SAMPLES = 20;
/** Per-query label SQL prefix budget. Our own catalog SQL — nonsecret. */
const LABEL_SQL_MAX = 60;
/** How many slowest queries per side the summary lists. */
const TOP_QUERIES = 15;
/** Bump when a JSONL field changes meaning, so old artifacts stay readable. */
const SCHEMA_VERSION = 1;

const ENV_SOURCE_URL = "PGDELTA_BENCH_SOURCE_URL";
const ENV_TARGET_URL = "PGDELTA_BENCH_TARGET_URL";
const ENV_RUN_LABEL = "PGDELTA_BENCH_RUN_LABEL";

export type Side = "source" | "target";

/** Nonsecret per-side `application_name`, so a DBA watching pg_stat_activity
 *  can attribute the load to this benchmark and to which side. */
const APP_NAME: Record<Side, string> = {
  source: "pgdelta-bench-source",
  target: "pgdelta-bench-target",
};

/** Phase order is the pipeline order — the summary prints it as-is.
 *  `extractSource` / `extractTarget` OVERLAP inside `extractInterval`; never
 *  sum them. All three are recorded so the overlap is measurable.
 *  Fresh-pool mode pays every phase; `--reuse-pools` legitimately reports 0 for
 *  poolConstruct / *FirstConnect after the first iteration and for poolShutdown
 *  before the last. */
export const PHASES = [
  "poolConstruct",
  "sourceFirstConnect",
  "targetFirstConnect",
  "profileResolve",
  "extractInterval",
  "extractSource",
  "extractTarget",
  "plan",
  "render",
  "format",
  "poolShutdown",
] as const;

export type PhaseName = (typeof PHASES)[number];
export type Phases = Record<PhaseName, number>;

function emptyPhases(): Phases {
  const phases = {} as Phases;
  for (const name of PHASES) phases[name] = 0;
  return phases;
}

// ── options ─────────────────────────────────────────────────────────────────

export type ProfileId = "supabase" | "raw";

export interface BenchmarkOptions {
  iterations: number;
  warmups: number;
  /** Keep pools alive across iterations (warm connections) instead of building
   *  fresh ones per iteration (cold — what a stateless worker actually pays). */
  reusePools: boolean;
  reverse: boolean;
  profileId: ProfileId;
  bytes: boolean;
  /** Concurrent catalog-query streams per extraction (1 = serial). */
  extractConcurrency: number;
  statementTimeoutMs?: number | undefined;
  /** Defaults to `<package>/.bench-artifacts`. */
  artifactsDir?: string | undefined;
  quiet?: boolean | undefined;
}

export const DEFAULT_OPTIONS: BenchmarkOptions = {
  iterations: 5,
  warmups: 1,
  reusePools: false,
  reverse: false,
  profileId: "supabase",
  bytes: false,
  extractConcurrency: 1,
};

/** Bad flags / missing env — the CLI wrapper turns this into exit(1) + usage. */
export class BenchmarkUsageError extends Error {}

const USAGE = `Usage: ${ENV_SOURCE_URL}=<url> ${ENV_TARGET_URL}=<url> \\
  bun scripts/benchmark-remote.ts [--iterations <n>] [--warmups <n>]
    [--reuse-pools] [--reverse] [--profile supabase|raw]
    [--statement-timeout <ms>] [--extract-concurrency <n>] [--bytes] [--quiet]

Connection strings are read ONLY from the environment:
  ${ENV_SOURCE_URL}   source (the apply target) connection string
  ${ENV_TARGET_URL}   target (desired state) connection string
  ${ENV_RUN_LABEL}    optional free-text nonsecret label recorded in artifacts`;

export function parseBenchmarkArgs(argv: string[]): BenchmarkOptions {
  const options: BenchmarkOptions = { ...DEFAULT_OPTIONS };
  const value = (index: number, flag: string): string => {
    const raw = argv[index];
    if (raw === undefined) {
      throw new BenchmarkUsageError(`${flag} requires a value`);
    }
    return raw;
  };
  const positive = (raw: string, flag: string): number => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new BenchmarkUsageError(
        `${flag} must be a non-negative number (got: ${raw})`,
      );
    }
    return Math.floor(parsed);
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case "--iterations":
        options.iterations = positive(value(++i, arg), arg);
        break;
      case "--warmups":
        options.warmups = positive(value(++i, arg), arg);
        break;
      case "--statement-timeout":
        options.statementTimeoutMs = positive(value(++i, arg), arg);
        break;
      case "--extract-concurrency": {
        const streams = positive(value(++i, arg), arg);
        if (streams < 1) {
          throw new BenchmarkUsageError(`${arg} must be at least 1`);
        }
        options.extractConcurrency = streams;
        break;
      }
      case "--profile": {
        const id = value(++i, arg);
        if (id !== "supabase" && id !== "raw") {
          throw new BenchmarkUsageError(
            `--profile must be supabase or raw (got: ${id})`,
          );
        }
        options.profileId = id;
        break;
      }
      case "--reuse-pools":
        options.reusePools = true;
        break;
      case "--reverse":
        options.reverse = true;
        break;
      case "--bytes":
        options.bytes = true;
        break;
      case "--quiet":
        options.quiet = true;
        break;
      case "--help":
      case "-h":
        throw new BenchmarkUsageError("help");
      default:
        // A connection string passed positionally is exactly what this script
        // refuses to accept — say so instead of a generic "unknown flag".
        throw new BenchmarkUsageError(
          `unknown argument "${arg}" — connection strings must come from ` +
            `${ENV_SOURCE_URL} / ${ENV_TARGET_URL}, never argv`,
        );
    }
  }
  if (options.iterations < 1) {
    throw new BenchmarkUsageError("--iterations must be at least 1");
  }
  return options;
}

// ── artifact records ────────────────────────────────────────────────────────

export interface SideStats {
  facts: number;
  edges: number;
  queryCount: number;
  /** Sum of this side's per-query ms — compare against `extractMs` to split
   *  server/network time from client-side JS (decode + FactBase build). */
  queryMsSum: number;
  extractMs: number;
  /** `extractMs - queryMsSum` — the part of extraction NOT spent waiting on a
   *  query (row decoding, FactBase construction, handlers). `null` whenever the
   *  REQUESTED `extractConcurrency > 1` (NOT `streamsObserved` — this is keyed
   *  on what was asked for, since that's what determines whether queries were
   *  ever ISSUED concurrently on the client side): concurrent query durations
   *  overlap, so their sum no longer bounds `extractMs` and the subtraction
   *  goes negative/meaningless. */
  clientResidual: number | null;
  diagnostics: number;
}

export interface RunRecord {
  kind: "run";
  schemaVersion: number;
  runId: string;
  iteration: number;
  warmup: boolean;
  engine: "next";
  profile: ProfileId;
  poolMode: "fresh" | "reused";
  reverse: boolean;
  /** Catalog-query streams per extraction (1 = the serial path). Records which
   *  extraction strategy the phase timings below actually measured. */
  extractConcurrency: number;
  /** Peak number of probe-wrapped clients simultaneously checked OUT of each
   *  side's pool during THIS iteration's extraction interval (reset right
   *  before, read right after `Promise.all([extract source, extract
   *  target])`). This is the ACTUAL fan-out achieved BY CHECKOUT, as opposed
   *  to the REQUESTED `extractConcurrency` above — `extract()` silently falls
   *  back to serial in some conditions (standby / pooler / spare-capacity), so
   *  a cell can be mislabeled "parallel" if only the requested value is
   *  trusted. CAVEAT: a client counts here the moment it's checked out, even
   *  if it never issues a query — e.g. a reserved snapshot-export/worker
   *  client whose setup then fails, leaving extraction to fall back to serial
   *  on the OTHER clients, still inflates this peak. See `streamsExecuted` for
   *  the metric that actually distinguishes that case. */
  streamsObserved: Record<Side, number>;
  /** Distinct clients that EXECUTED at least one extraction-phase query during
   *  the same reset window as `streamsObserved`. Unlike that checkout-based
   *  peak, this can't be inflated by a reserved-but-unused worker client — it
   *  only counts a stream once real work actually ran on it, which is what
   *  makes it the reliable signal for "extraction actually fanned out". */
  streamsExecuted: Record<Side, number>;
  runLabel: string | null;
  pgMajor: number | null;
  rttMs: Record<Side, { minMs: number; medianMs: number }>;
  wallMs: number;
  cpuUserMs: number;
  cpuSystemMs: number;
  phases: Phases;
  source: SideStats;
  target: SideStats;
  actions: number;
  sqlBytes: number;
  /** false when the presentation-only formatter threw on this plan's SQL; the
   *  `format` phase still carries the time spent before the throw. */
  formatOk: boolean;
  rssBytes: number;
}

/** `"profile"` for queries issued while `resolveProfile` is still running
 *  (against the source pool, before extraction starts) — `"extract"` for
 *  everything from there on. The probe is attached before `resolveProfile`
 *  runs, so profile-resolution queries land in the JSONL too (useful), but
 *  they must never be folded into a side's `queryCount` / `queryMsSum` /
 *  `clientResidual`, which describe extraction specifically. */
export type QueryPhase = "profile" | "extract";

export interface QueryRecord {
  kind: "query";
  runId: string;
  iteration: number;
  /** Warmup and measured iterations both number from 0 — this field (not
   *  `iteration`) is the only reliable way to exclude warmup records from a
   *  measured-only summary. */
  warmup: boolean;
  side: Side;
  seq: number;
  phase: QueryPhase;
  /** Catalog relation + a truncated prefix of OUR OWN SQL. Never user DDL. */
  label: string;
  /** First 12 hex chars of sha256(full SQL text) — see `sqlHash`. Grouping key
   *  for the top-queries summary; `label` alone can collide across distinct
   *  queries. */
  sqlHash: string;
  ms: number;
  rows: number;
  ok: boolean;
  /** SQLSTATE only — never the driver's message (it can quote user SQL). */
  code?: string;
  bytes?: number;
}

export interface BenchmarkResult {
  runId: string;
  artifactPath: string;
  runs: RunRecord[];
  queries: QueryRecord[];
}

// ── per-query instrumentation ───────────────────────────────────────────────

/** Marker so a pooled client handed out twice is wrapped at most once. */
const WRAPPED = Symbol("pgdelta-bench-wrapped");

/** The SQL text of a `client.query` call, for either the string or the
 *  QueryConfig overload. */
function sqlTextOf(first: unknown): string {
  if (typeof first === "string") return first;
  if (first !== null && typeof first === "object") {
    const text = (first as { text?: unknown }).text;
    if (typeof text === "string") return text;
  }
  return "";
}

/** Identify which extractor a SQL string belongs to: the first FROM relation
 *  plus a short head (same heuristic as scripts/perf-timing.ts::queryLabel,
 *  kept local so this script's label format can evolve independently). */
export function queryLabel(sql: string): string {
  const flat = sql.replace(/\s+/g, " ").trim();
  const from = /\bFROM\s+(?:pg_catalog\.)?(\w+)/i.exec(flat);
  return `${from?.[1] ?? "?"} | ${flat.slice(0, LABEL_SQL_MAX)}`;
}

/** First 12 hex chars of sha256(sql) — a stable identity for grouping queries
 *  whose DISPLAYED `queryLabel` (catalog relation + a 60-char prefix) can
 *  collide across genuinely DIFFERENT SQL — e.g. the three lookups in
 *  src/extract/types.ts, or routines vs aggregates in src/extract/routines.ts
 *  both starting `SELECT ... FROM pg_proc`. Grouping the top-queries median by
 *  label alone silently merges those into one bogus number. */
function sqlHash(sql: string): string {
  return createHash("sha256").update(sql).digest("hex").slice(0, 12);
}

/** node-pg resolves a multi-statement batch (src/extract/scope.ts's
 *  `makeBatchRunner`) with an ARRAY of per-statement results instead of one —
 *  `result.rows` is then undefined. Normalize both shapes to a single
 *  combined rows array so a batched query's sink record isn't silently
 *  undercounted (rows: 0, and no bytes even with `--bytes`) — same fix as
 *  scripts/explain-top-queries.ts's probe. */
function combinedRows(
  result: { rows: unknown[] } | { rows: unknown[] }[],
): unknown[] {
  if (Array.isArray(result)) {
    const combined: unknown[] = [];
    for (const one of result) combined.push(...one.rows);
    return combined;
  }
  return result.rows;
}

/** SQLSTATE of a driver error, or undefined. Deliberately drops `.message`. */
function errorCode(error: unknown): string | undefined {
  if (error !== null && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

/** Collects per-query records for one iteration, numbering them per side. */
class QuerySink {
  readonly records: QueryRecord[] = [];
  readonly #seq: Record<Side, number> = { source: 0, target: 0 };
  /** Starts in the `"profile"` phase — the probe is attached before
   *  `resolveProfile` runs. Call `markExtractPhase()` once `resolveProfile`
   *  resolves, before extraction starts. */
  #phase: QueryPhase = "profile";

  constructor(
    private readonly runId: string,
    private readonly iteration: number,
    private readonly warmup: boolean,
    private readonly withBytes: boolean,
  ) {}

  markExtractPhase(): void {
    this.#phase = "extract";
  }

  record(
    side: Side,
    label: string,
    hash: string,
    ms: number,
    rows: unknown[] | undefined,
    ok: boolean,
    code?: string,
  ): void {
    const record: QueryRecord = {
      kind: "query",
      runId: this.runId,
      iteration: this.iteration,
      warmup: this.warmup,
      side,
      seq: this.#seq[side]++,
      phase: this.#phase,
      label,
      sqlHash: hash,
      ms,
      rows: rows?.length ?? 0,
      ok,
      ...(code !== undefined ? { code } : {}),
      // stringify is charged AFTER the timing capture above, but it still burns
      // CPU inside the measured extraction interval — hence opt-in.
      ...(this.withBytes && rows !== undefined
        ? { bytes: Buffer.byteLength(JSON.stringify(rows)) }
        : {}),
    };
    this.records.push(record);
  }
}

/** True when the last element of `args` is a Node-style `(err, result) =>
 *  void` callback — i.e. the CALLBACK overload of `client.query`, which
 *  returns `undefined` rather than a promise. `pg-pool`'s own `Pool.query`
 *  ALWAYS calls the underlying `client.query` this way (it builds its own
 *  callback internally, regardless of whether ITS caller awaited a promise —
 *  see `pg-pool`'s `query()`), so this is the ONLY way a query issued via
 *  `pool.query(...)` (as `resolveProfile`'s `probeApplierCapability` /
 *  `probePgMajor` do) is ever observable here. */
function callbackArgOf(
  args: readonly unknown[],
):
  | ((err: unknown, result: { rows: unknown[] } | undefined) => void)
  | undefined {
  const last = args[args.length - 1];
  return typeof last === "function"
    ? (last as (err: unknown, result: { rows: unknown[] } | undefined) => void)
    : undefined;
}

/** What `attachQueryProbe` hands back: `detach` restores the pool/clients,
 *  `resetStreams`/`peakStreams` track the peak number of probe-wrapped clients
 *  simultaneously checked OUT of this pool (connected, not yet released) since
 *  the last reset — the ACTUAL concurrent fan-out `extract()` achieved, as
 *  opposed to the `--extract-concurrency` value it was asked for. */
interface QueryProbe {
  detach: () => void;
  /** Rebase the peak to the CURRENTLY checked-out count and clear the
   *  executed-clients set, so an earlier phase's single connect/release (e.g.
   *  the first-connect probe) doesn't pollute either metric measured over a
   *  later interval (e.g. extraction). */
  resetStreams: () => void;
  peakStreams: () => number;
  /** Count of DISTINCT clients that have actually EXECUTED at least one query
   *  since the last `resetStreams()` — as opposed to `peakStreams()`, which
   *  counts a client the moment it's checked out, even if it's a reserved
   *  worker client that never issues a query (e.g. snapshot export/worker
   *  setup failed and extraction fell back to serial). */
  executedStreams: () => number;
}

/**
 * Wrap `pool.connect` so every checked-out client's `query` is timed, then hand
 * back a detach function that restores BOTH `pool.connect` and every client it
 * wrapped. Measurement only — mirrors scripts/perf-timing.ts, but also handles
 * `connect`'s callback overload (which `pool.query` uses internally, and
 * `resolveProfile` calls `pool.query` directly) AND `query`'s own callback
 * overload (see `callbackArgOf`), so profile-resolution queries are captured
 * at all, not just extraction's promise-form `client.query` calls.
 */
function attachQueryProbe(
  pool: pg.Pool,
  side: Side,
  sink: QuerySink,
): QueryProbe {
  const originalConnect = pool.connect.bind(pool);
  const wrappedClients: Array<{
    client: pg.PoolClient;
    descriptor: PropertyDescriptor | undefined;
  }> = [];

  // `active` counts clients currently checked out (connected, not yet
  // released) on THIS pool; `peak` is the high-water mark since the last
  // `resetStreams()`. `executedClients` is the distinct set of clients that
  // actually ISSUED a query since the last reset — see `QueryProbe`.
  let active = 0;
  let peak = 0;
  const executedClients = new Set<pg.PoolClient>();

  const wrapClient = (client: pg.PoolClient | undefined): void => {
    if (client === undefined) return;
    active++;
    peak = Math.max(peak, active);

    // pg-pool's own `_acquireClient` reassigns `client.release` on EVERY
    // checkout (a fresh `_releaseOnce` closure, so release-once is enforced
    // per checkout) — see pg-pool/index.js. A counting wrapper installed on
    // an earlier checkout of this SAME client object is therefore silently
    // discarded by the time a reused (idle-then-recycled) client is checked
    // out again, so `active` would never decrement for it. Reinstall the
    // counter on EVERY checkout, not just the first, to stay paired with
    // whatever `release` currently points at.
    const originalRelease = client.release.bind(client) as (
      ...args: unknown[]
    ) => unknown;
    (client as { release: unknown }).release = (...args: unknown[]) => {
      active--;
      return originalRelease(...args);
    };

    const slot = client as unknown as Record<symbol, unknown>;
    if (slot[WRAPPED] === true) return;
    slot[WRAPPED] = true;
    const originalQuery = client.query.bind(client) as (
      ...args: unknown[]
    ) => unknown;
    // Remember whether `query` was an OWN property before we shadowed the
    // prototype method, so detach restores the exact original shape. `query`
    // (unlike `release`) is never reassigned by pg-pool between checkouts, so
    // wrapping it once for this client's lifetime is correct and sufficient.
    wrappedClients.push({
      client,
      descriptor: Object.getOwnPropertyDescriptor(client, "query"),
    });
    (client as { query: unknown }).query = (...args: unknown[]) => {
      const start = performance.now();
      executedClients.add(client);
      const text = sqlTextOf(args[0]);
      const label = queryLabel(text);
      const hash = sqlHash(text);
      const callback = callbackArgOf(args);
      if (callback !== undefined) {
        // Callback overload (pg-pool's internal `Pool.query()` shape) — wrap
        // the callback itself instead of the (nonexistent) return value.
        const wrappedArgs = [...args];
        wrappedArgs[wrappedArgs.length - 1] = (
          error: unknown,
          result: { rows: unknown[] } | undefined,
        ) => {
          if (error != null) {
            sink.record(
              side,
              label,
              hash,
              performance.now() - start,
              undefined,
              false,
              errorCode(error),
            );
          } else {
            sink.record(
              side,
              label,
              hash,
              performance.now() - start,
              result?.rows,
              true,
            );
          }
          callback(error, result);
        };
        return originalQuery(...wrappedArgs);
      }
      const returned = originalQuery(...args);
      // Neither overload matched (e.g. no query text) — nothing to time.
      if (
        returned == null ||
        typeof (returned as { then?: unknown }).then !== "function"
      ) {
        return returned;
      }
      return (
        returned as Promise<{ rows: unknown[] } | { rows: unknown[] }[]>
      ).then(
        (result) => {
          sink.record(
            side,
            label,
            hash,
            performance.now() - start,
            combinedRows(result),
            true,
          );
          return result;
        },
        (error: unknown) => {
          // A failed/timed-out query is exactly what a perf investigation needs
          // to see, so record it — SQLSTATE only, never the message.
          sink.record(
            side,
            label,
            hash,
            performance.now() - start,
            undefined,
            false,
            errorCode(error),
          );
          throw error;
        },
      );
    };
  };

  (pool as { connect: unknown }).connect = (...args: unknown[]) => {
    const callback = args[0];
    if (typeof callback === "function") {
      return (originalConnect as (cb: unknown) => void)(
        (
          error: unknown,
          client: pg.PoolClient | undefined,
          release: unknown,
        ) => {
          wrapClient(client);
          (callback as (...a: unknown[]) => void)(error, client, release);
        },
      );
    }
    return (originalConnect as () => Promise<pg.PoolClient>)().then(
      (client) => {
        wrapClient(client);
        return client;
      },
    );
  };

  // A pool keeps its clients idle between iterations, so a patched `query`
  // left behind would keep recording into a stale sink — un-wrap every
  // client too. `release` is NOT restored here: pg-pool reassigns it fresh on
  // every real checkout regardless of what we leave behind (see `wrapClient`
  // above), so there is nothing stable to restore, and restoring a stale
  // snapshot risks clobbering pg-pool's own live release function if a client
  // were ever still checked out at detach time.
  const detach = (): void => {
    (pool as { connect: unknown }).connect = originalConnect;
    for (const { client, descriptor } of wrappedClients) {
      if (descriptor !== undefined) {
        Object.defineProperty(client, "query", descriptor);
      } else {
        delete (client as unknown as Record<string, unknown>)["query"];
      }
      delete (client as unknown as Record<symbol, unknown>)[WRAPPED];
    }
  };

  return {
    detach,
    resetStreams: () => {
      peak = active;
      executedClients.clear();
    },
    peakStreams: () => peak,
    executedStreams: () => executedClients.size,
  };
}

// ── stats helpers ───────────────────────────────────────────────────────────

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(q * sorted.length) - 1),
  );
  return sorted[index]!;
}

function summarize(values: number[]): {
  min: number;
  p50: number;
  p90: number;
  max: number;
} {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    min: sorted[0] ?? 0,
    p50: quantile(sorted, 0.5),
    p90: quantile(sorted, 0.9),
    max: sorted[sorted.length - 1] ?? 0,
  };
}

function pgMajorOf(pgVersion: string): number | null {
  const match = /^(\d+)/.exec(pgVersion);
  return match?.[1] !== undefined ? Number(match[1]) : null;
}

// ── pipeline pieces ─────────────────────────────────────────────────────────

function makeBenchPool(url: string, side: Side): pg.Pool {
  const pool = new pg.Pool({
    connectionString: url,
    max: POOL_MAX,
    application_name: APP_NAME[side],
  });
  // Never crash the benchmark on an idle-client error, and never print the
  // driver's message (it can carry the endpoint).
  pool.on("error", () => {});
  return pool;
}

/** Read the two connection strings from the environment ONLY. `--reverse`
 *  swaps which env var plays the source role. */
function readConnections(reverse: boolean): { source: string; target: string } {
  const a = process.env[ENV_SOURCE_URL];
  const b = process.env[ENV_TARGET_URL];
  if (a === undefined || a === "" || b === undefined || b === "") {
    const missing = [
      a === undefined || a === "" ? ENV_SOURCE_URL : undefined,
      b === undefined || b === "" ? ENV_TARGET_URL : undefined,
    ].filter((name): name is string => name !== undefined);
    throw new BenchmarkUsageError(
      `missing required environment variable(s): ${missing.join(", ")}`,
    );
  }
  return reverse ? { source: b, target: a } : { source: a, target: b };
}

/** `SELECT 1` × RTT_SAMPLES on one already-warm connection: the floor any
 *  round-trip in the extraction pays. Runs BEFORE the measured iterations on a
 *  dedicated pool, so it never lands in the per-query records. */
async function measureRtt(
  url: string,
  side: Side,
): Promise<{ minMs: number; medianMs: number }> {
  const pool = makeBenchPool(url, side);
  try {
    const client = await pool.connect();
    try {
      await client.query("SELECT 1"); // warm the connection first
      const samples: number[] = [];
      for (let i = 0; i < RTT_SAMPLES; i++) {
        const start = performance.now();
        await client.query("SELECT 1");
        samples.push(performance.now() - start);
      }
      samples.sort((a, b) => a - b);
      return { minMs: samples[0] ?? 0, medianMs: quantile(samples, 0.5) };
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

async function timed<T>(
  phases: Phases,
  name: PhaseName,
  fn: () => Promise<T> | T,
): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    phases[name] = performance.now() - start;
  }
}

function sideStats(
  result: ExtractResult,
  extractMs: number,
  records: readonly QueryRecord[],
  side: Side,
  extractConcurrency: number,
): SideStats {
  // Profile-resolution queries (issued before `resolveProfile` returns) are
  // real work, but attributing them to extraction would understate
  // `clientResidual` in serial runs — extraction's `extractMs` never covers
  // that time. Keep them in the JSONL; exclude them here.
  const mine = records.filter((r) => r.side === side && r.phase === "extract");
  let queryMsSum = 0;
  for (const record of mine) queryMsSum += record.ms;
  return {
    facts: result.factBase.facts().length,
    edges: result.factBase.edges.length,
    queryCount: mine.length,
    queryMsSum,
    extractMs,
    clientResidual: extractConcurrency > 1 ? null : extractMs - queryMsSum,
    diagnostics: result.diagnostics.length,
  };
}

// ── the run ─────────────────────────────────────────────────────────────────

export async function runBenchmark(
  options: BenchmarkOptions,
): Promise<BenchmarkResult> {
  const { source: sourceUrl, target: targetUrl } = readConnections(
    options.reverse,
  );
  const runId = randomUUID();
  const runLabel = process.env[ENV_RUN_LABEL] ?? null;
  const artifactsDir =
    options.artifactsDir ??
    fileURLToPath(new URL("../.bench-artifacts/", import.meta.url));
  mkdirSync(artifactsDir, { recursive: true });
  const artifactPath = `${artifactsDir.replace(/\/$/, "")}/${runId}.jsonl`;
  const log = (line: string): void => {
    if (options.quiet !== true) console.log(line);
  };

  log(`run ${runId}${runLabel !== null ? ` (${runLabel})` : ""}`);
  log(
    `profile=${options.profileId} poolMode=${
      options.reusePools ? "reused" : "fresh"
    } reverse=${options.reverse} extractConcurrency=${
      options.extractConcurrency
    } warmups=${options.warmups} iterations=${options.iterations}`,
  );

  const rttMs: Record<Side, { minMs: number; medianMs: number }> = {
    source: await measureRtt(sourceUrl, "source"),
    target: await measureRtt(targetUrl, "target"),
  };
  log(
    `rtt source min=${rttMs.source.minMs.toFixed(2)}ms p50=${rttMs.source.medianMs.toFixed(2)}ms  ` +
      `target min=${rttMs.target.minMs.toFixed(2)}ms p50=${rttMs.target.medianMs.toFixed(2)}ms`,
  );

  const integrationProfile =
    options.profileId === "supabase" ? supabaseProfile : rawProfile;

  const runs: RunRecord[] = [];
  const queries: QueryRecord[] = [];
  const total = options.warmups + options.iterations;

  // Reused-pool mode builds the pair once; the per-iteration poolConstruct /
  // firstConnect / poolShutdown phases are then legitimately 0 (nothing is
  // paid), and the single shutdown is charged to the LAST iteration.
  let shared: { source: pg.Pool; target: pg.Pool } | undefined;

  try {
    for (let index = 0; index < total; index++) {
      const warmup = index < options.warmups;
      const iteration = warmup ? index : index - options.warmups;
      const phases = emptyPhases();
      const sink = new QuerySink(runId, iteration, warmup, options.bytes);
      const cpuBefore = process.cpuUsage();
      const wallStart = performance.now();

      let pools: { source: pg.Pool; target: pg.Pool };
      if (options.reusePools) {
        if (shared === undefined) {
          shared = await timed(phases, "poolConstruct", () => ({
            source: makeBenchPool(sourceUrl, "source"),
            target: makeBenchPool(targetUrl, "target"),
          }));
        }
        pools = shared;
      } else {
        pools = await timed(phases, "poolConstruct", () => ({
          source: makeBenchPool(sourceUrl, "source"),
          target: makeBenchPool(targetUrl, "target"),
        }));
      }

      const probes = {
        source: attachQueryProbe(pools.source, "source", sink),
        target: attachQueryProbe(pools.target, "target", sink),
      };

      let record: RunRecord;
      try {
        try {
          // Explicit first connect per side, BEFORE profile resolution, so the
          // TLS handshake / auth cost is isolated instead of hiding inside the
          // first extraction. Skipped (0) when the pool is already warm.
          if (!options.reusePools || index === 0) {
            await timed(phases, "sourceFirstConnect", async () => {
              (await pools.source.connect()).release();
            });
            await timed(phases, "targetFirstConnect", async () => {
              (await pools.target.connect()).release();
            });
          }

          // Resolve against the SOURCE pool: the source is the apply target, so
          // its capability / baseline govern the managed view (see cmdPlan).
          const resolved: ResolvedProfile = await timed(
            phases,
            "profileResolve",
            () =>
              resolveProfile(pools.source, integrationProfile, {
                redactSecrets: true,
              }),
          );
          // Everything from here on is extraction proper — queries recorded
          // before this point (profile resolution, against the source pool)
          // stay in the JSONL but are excluded from side attribution/summaries.
          sink.markExtractPhase();
          // Rebase the streams-observed peak to right before extraction starts,
          // so the single connect/release pair from sourceFirstConnect /
          // targetFirstConnect / profileResolve above never inflates it.
          probes.source.resetStreams();
          probes.target.resetStreams();

          const extractOptions = {
            redactSecrets: true,
            concurrency: options.extractConcurrency,
            ...(options.statementTimeoutMs !== undefined
              ? { statementTimeoutMs: options.statementTimeoutMs }
              : {}),
          };

          let extractSourceMs = 0;
          let extractTargetMs = 0;
          const intervalStart = performance.now();
          const [sourceResult, targetResult] = await Promise.all([
            (async () => {
              const start = performance.now();
              try {
                return await resolved.extract(pools.source, extractOptions);
              } finally {
                extractSourceMs = performance.now() - start;
              }
            })(),
            (async () => {
              const start = performance.now();
              try {
                return await resolved.extract(pools.target, extractOptions);
              } finally {
                extractTargetMs = performance.now() - start;
              }
            })(),
          ]);
          phases.extractInterval = performance.now() - intervalStart;
          phases.extractSource = extractSourceMs;
          phases.extractTarget = extractTargetMs;
          // Read the peak AFTER both extractions have settled — it's the high
          // water mark over the whole overlapping interval, not a snapshot.
          const streamsObserved: Record<Side, number> = {
            source: probes.source.peakStreams(),
            target: probes.target.peakStreams(),
          };
          const streamsExecuted: Record<Side, number> = {
            source: probes.source.executedStreams(),
            target: probes.target.executedStreams(),
          };

          // Where cmdPlan calls printDiagnostics + exitIfBlocking. Here advisory
          // diagnostics are only COUNTED (into each side's `diagnostics` field):
          // a real project always has some, and aborting on one would make the
          // benchmark unusable. Nothing is printed — a diagnostic message can
          // quote a user object's definition.
          const planOptions: PlanOptions = {
            renames: "off",
            compact: true,
            redactSecrets: true,
            ...resolved.planOptions, // policy, capability, baseline, intentRules
          };
          const thePlan = await timed(phases, "plan", () =>
            plan(sourceResult.factBase, targetResult.factBase, planOptions),
          );

          // allowDrops: a real source→target diff routinely drops; the gate is a
          // safety prompt for humans, irrelevant to a read-only measurement.
          const rendered = await timed(phases, "render", () =>
            renderPlanFiles(thePlan, { allowDrops: true }),
          );
          let sqlBytes = 0;
          for (const file of rendered.files) {
            sqlBytes += Buffer.byteLength(file.contents, "utf8");
          }

          let formatOk = true;
          await timed(phases, "format", () => {
            try {
              formatSqlStatements(rendered.files.map((file) => file.contents));
            } catch {
              formatOk = false;
            }
          });

          const cpu = process.cpuUsage(cpuBefore);
          record = {
            kind: "run",
            schemaVersion: SCHEMA_VERSION,
            runId,
            iteration,
            warmup,
            engine: "next",
            profile: options.profileId,
            poolMode: options.reusePools ? "reused" : "fresh",
            reverse: options.reverse,
            extractConcurrency: options.extractConcurrency,
            streamsObserved,
            streamsExecuted,
            runLabel,
            pgMajor: pgMajorOf(sourceResult.pgVersion),
            rttMs,
            wallMs: performance.now() - wallStart,
            cpuUserMs: cpu.user / 1000,
            cpuSystemMs: cpu.system / 1000,
            phases,
            source: sideStats(
              sourceResult,
              extractSourceMs,
              sink.records,
              "source",
              options.extractConcurrency,
            ),
            target: sideStats(
              targetResult,
              extractTargetMs,
              sink.records,
              "target",
              options.extractConcurrency,
            ),
            actions: thePlan.actions.length,
            sqlBytes,
            formatOk,
            rssBytes: process.memoryUsage().rss,
          };
        } finally {
          probes.source.detach();
          probes.target.detach();
        }

        if (!options.reusePools) {
          await timed(phases, "poolShutdown", () =>
            Promise.all([pools.source.end(), pools.target.end()]),
          );
        } else if (index === total - 1 && shared !== undefined) {
          const closing = shared;
          shared = undefined;
          await timed(phases, "poolShutdown", () =>
            Promise.all([closing.source.end(), closing.target.end()]),
          );
        }
      } catch (error) {
        // A failure anywhere above (connect/extract/plan/render, or even the
        // normal shutdown just attempted) must not leak a live fresh pool to
        // whatever caught runBenchmark()'s rejection — always end it,
        // best-effort, before propagating. Reused pools are the caller's
        // responsibility across iterations (see the outer `finally` below).
        if (!options.reusePools) {
          await Promise.all([pools.source.end(), pools.target.end()]).catch(
            () => {},
          );
        }
        throw error;
      }
      // poolShutdown lands after the record was built; re-read it so the
      // artifact carries the real value (phases is the same object).
      record.wallMs = performance.now() - wallStart;

      runs.push(record);
      queries.push(...sink.records);
      appendFileSync(
        artifactPath,
        [record, ...sink.records].map((r) => JSON.stringify(r)).join("\n") +
          "\n",
        "utf8",
      );
      log(
        `  ${warmup ? "warmup" : "iter  "} ${String(iteration).padStart(2)}  ` +
          `wall=${record.wallMs.toFixed(0).padStart(7)}ms  ` +
          `extract=${phases.extractInterval.toFixed(0).padStart(7)}ms  ` +
          `plan=${phases.plan.toFixed(0).padStart(6)}ms  ` +
          `actions=${record.actions}`,
      );
    }
  } finally {
    if (shared !== undefined) {
      await Promise.all([shared.source.end(), shared.target.end()]).catch(
        () => {},
      );
    }
  }

  if (options.quiet !== true) {
    printSummary(runs, queries, artifactPath);
  }
  return { runId, artifactPath, runs, queries };
}

// ── summary ─────────────────────────────────────────────────────────────────

export function printSummary(
  runs: readonly RunRecord[],
  queries: readonly QueryRecord[],
  artifactPath: string,
): void {
  const measured = runs.filter((run) => !run.warmup);
  if (measured.length === 0) {
    console.log("\nno measured iterations");
    return;
  }

  console.log(`\nphases over ${measured.length} measured iteration(s), ms`);
  console.log(
    `${"phase".padEnd(20)}${"p50".padStart(10)}${"p90".padStart(10)}` +
      `${"min".padStart(10)}${"max".padStart(10)}`,
  );
  for (const name of PHASES) {
    const stats = summarize(measured.map((run) => run.phases[name]));
    console.log(
      name.padEnd(20) +
        stats.p50.toFixed(1).padStart(10) +
        stats.p90.toFixed(1).padStart(10) +
        stats.min.toFixed(1).padStart(10) +
        stats.max.toFixed(1).padStart(10),
    );
  }
  console.log(
    "  (extractSource/extractTarget OVERLAP inside extractInterval — never sum them)",
  );

  // extract() silently falls back to serial in some conditions (standby /
  // pooler / spare-capacity) even when more streams were requested — a cell
  // that trusts only `extractConcurrency` can be mislabeled "parallel". Flag
  // every measured iteration where the ACTUAL executed fan-out fell short.
  // `streamsExecuted` (not the checkout-based `streamsObserved`) is used here
  // on purpose: a reserved-but-unused worker client (e.g. snapshot export
  // failed, extraction fell back to serial) still counts toward
  // `streamsObserved`'s peak, masking exactly the case this check exists to
  // catch.
  const understreamed = measured.filter(
    (run) =>
      run.streamsExecuted.source < run.extractConcurrency ||
      run.streamsExecuted.target < run.extractConcurrency,
  );
  if (understreamed.length > 0) {
    console.log(
      `\n!!! streamsExecuted FELL SHORT of extractConcurrency=${understreamed[0]!.extractConcurrency} ` +
        `on ${understreamed.length}/${measured.length} measured iteration(s) — extract() likely fell ` +
        `back to serial (standby / pooler / spare-capacity), or a reserved worker client never ` +
        `executed a query. Cells below may be mislabeled "parallel". !!!`,
    );
  }

  console.log("\nwall / cpu / rss");
  for (const [label, values] of [
    ["wallMs", measured.map((r) => r.wallMs)],
    ["cpuUserMs", measured.map((r) => r.cpuUserMs)],
    ["cpuSystemMs", measured.map((r) => r.cpuSystemMs)],
  ] as const) {
    const stats = summarize([...values]);
    console.log(
      `${label.padEnd(20)}${stats.p50.toFixed(1).padStart(10)}` +
        `${stats.p90.toFixed(1).padStart(10)}${stats.min.toFixed(1).padStart(10)}` +
        `${stats.max.toFixed(1).padStart(10)}`,
    );
  }
  const rss = summarize(measured.map((r) => r.rssBytes));
  console.log(
    `rss p50=${(rss.p50 / 1e6).toFixed(0)}MB max=${(rss.max / 1e6).toFixed(0)}MB`,
  );

  // Client-side residual: the part of a side's extraction wall-time NOT spent
  // waiting on a query — row decoding, FactBase construction, handlers. Only
  // meaningful when queries run serially; with extractConcurrency > 1 their
  // durations overlap, so wall - sqlSum no longer bounds anything.
  console.log("\nper-side attribution (p50 over measured iterations, ms)");
  for (const side of ["source", "target"] as const) {
    const wall = summarize(measured.map((r) => r[side].extractMs)).p50;
    const sql = summarize(measured.map((r) => r[side].queryMsSum)).p50;
    const stats = measured[measured.length - 1]![side];
    // p50(extractMs) - p50(queryMsSum) is NOT p50(residual): subtracting two
    // INDEPENDENT percentiles discards the per-iteration pairing. Summarize
    // the already-correct per-run `clientResidual` values directly instead.
    const residualValues = measured
      .map((r) => r[side].clientResidual)
      .filter((value): value is number => value !== null);
    const residual =
      residualValues.length === 0
        ? "n/a (parallel)".padStart(7)
        : summarize(residualValues).p50.toFixed(0).padStart(7);
    console.log(
      `${side.padEnd(8)} extract=${wall.toFixed(0).padStart(7)}  ` +
        `sqlSum=${sql.toFixed(0).padStart(7)}  ` +
        `clientResidual=${residual}  ` +
        `queries=${String(stats.queryCount).padStart(4)}  ` +
        `facts=${stats.facts}  edges=${stats.edges}  diagnostics=${stats.diagnostics}`,
    );
  }

  for (const side of ["source", "target"] as const) {
    // Group by the FULL-SQL hash, not the displayed `label` — `label` is a
    // catalog relation name + a 60-char prefix, and distinct queries
    // routinely collide on that (the three lookups in src/extract/types.ts;
    // routines vs aggregates in src/extract/routines.ts). Grouping by label
    // would silently merge those into one bogus median.
    const byHash = new Map<string, { label: string; values: number[] }>();
    for (const query of queries) {
      if (query.side !== side) continue;
      // Warmup and measured iterations both number from 0 — `warmup` (not
      // `iteration`) is what actually distinguishes them.
      if (query.warmup) continue;
      // Profile-resolution queries are excluded from the per-side attribution
      // above; keep the top-queries ranking consistent with that.
      if (query.phase !== "extract") continue;
      const bucket = byHash.get(query.sqlHash);
      if (bucket === undefined) {
        byHash.set(query.sqlHash, { label: query.label, values: [query.ms] });
      } else {
        bucket.values.push(query.ms);
      }
    }
    // Two DIFFERENT sqlHash groups can still share the same DISPLAYED label —
    // disambiguate only those with the hash, so an unambiguous label stays
    // unadorned.
    const labelCounts = new Map<string, number>();
    for (const { label } of byHash.values()) {
      labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
    }
    const ranked = [...byHash.entries()]
      .map(([hash, { label, values }]) => ({
        label: (labelCounts.get(label) ?? 0) > 1 ? `${label} [${hash}]` : label,
        median: summarize(values).p50,
        count: values.length,
      }))
      .sort((a, b) => b.median - a.median)
      .slice(0, TOP_QUERIES);
    console.log(`\ntop ${ranked.length} ${side} queries by median ms`);
    for (const entry of ranked) {
      console.log(
        `${entry.median.toFixed(1).padStart(9)}  x${String(entry.count).padStart(3)}  ${entry.label}`,
      );
    }
  }

  const last = measured[measured.length - 1]!;
  console.log(
    `\nactions=${last.actions} sqlBytes=${last.sqlBytes} formatOk=${last.formatOk} pgMajor=${last.pgMajor}`,
  );
  console.log(`artifact: ${artifactPath}`);
}

// ── CLI entry ───────────────────────────────────────────────────────────────

/** Best-effort scrub of every connection-string component — AND the raw
 *  connection strings themselves — from a driver error's message before it is
 *  ever printed. A non-usage failure (connection refused, auth failure, an
 *  invalid URL) can otherwise quote the host/port/user/password/database
 *  straight from the env-provided connection string. Same needle-derivation
 *  pattern as scripts/benchmark-remote.smoke.ts's local `redact` helper,
 *  duplicated here because this is the CLI's OWN failure path, not a test. */
function redactConnectionDetails(text: string): string {
  const needles: string[] = [];
  for (const name of [ENV_SOURCE_URL, ENV_TARGET_URL]) {
    const raw = process.env[name];
    if (raw === undefined || raw === "") continue;
    needles.push(raw);
    try {
      const parsed = new URL(raw);
      for (const part of [
        parsed.hostname,
        parsed.port,
        parsed.username,
        parsed.password,
      ]) {
        if (part !== "") needles.push(part);
      }
    } catch {
      // Not a parseable URL — the raw needle above still covers it verbatim.
    }
  }
  let scrubbed = text;
  for (const needle of needles) {
    scrubbed = scrubbed.split(needle).join("[redacted]");
  }
  return scrubbed;
}

if (import.meta.main) {
  try {
    await runBenchmark(parseBenchmarkArgs(process.argv.slice(2)));
  } catch (error) {
    if (error instanceof BenchmarkUsageError) {
      if (error.message !== "help") {
        process.stderr.write(`benchmark-remote: ${error.message}\n\n`);
      }
      process.stderr.write(`${USAGE}\n`);
      process.exit(1);
    }
    // A non-usage failure (connection refused, auth failure, an invalid URL)
    // must never reach the console raw — never print `.stack` and never the
    // unscrubbed `.message`. Print name/code plus a scrubbed message only.
    const name = error instanceof Error ? error.name : typeof error;
    const code =
      error !== null && typeof error === "object" && "code" in error
        ? String((error as { code: unknown }).code)
        : undefined;
    const rawMessage = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `benchmark-remote: fatal name=${name}` +
        `${code !== undefined ? ` code=${code}` : ""}` +
        ` message=${redactConnectionDetails(rawMessage)}\n`,
    );
    process.exit(1);
  }
}
