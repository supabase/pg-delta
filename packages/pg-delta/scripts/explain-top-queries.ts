#!/usr/bin/env bun
/**
 * READ-ONLY server-side attribution for pg-delta's remote extraction.
 *
 * `scripts/benchmark-remote.ts` measures CLIENT wall time per catalog query.
 * This script goes one level deeper: it runs the production extraction once
 * (capturing the full SQL text + client ms per query, same probe pattern as
 * benchmark-remote.ts), ranks the slowest real SELECT/WITH queries, then
 * re-runs each of them through `EXPLAIN (ANALYZE, BUFFERS, SETTINGS, FORMAT
 * JSON)` inside a session that reproduces extraction's exact semantics
 * (`src/extract/extract.ts`): a REPEATABLE READ READ ONLY transaction, pinned
 * `search_path`, JIT disabled, optional `statement_timeout` — then ROLLBACK.
 * This splits client wall time into server execution vs network/transfer.
 *
 *   PGDELTA_BENCH_SOURCE_URL=... bun scripts/explain-top-queries.ts [flags]
 *
 * Flags:
 *   --env-var NAME             read the connection string from this env var
 *                              instead of PGDELTA_BENCH_SOURCE_URL (must start
 *                              with PGDELTA_)
 *   --top <n>                  how many top queries to EXPLAIN (default 8)
 *   --statement-timeout <ms>   passthrough to extraction + SET LOCAL
 *                              statement_timeout for the EXPLAIN pass
 *                              (default 120000)
 *
 * The connection string comes ONLY from the environment — never argv — and is
 * NEVER printed or written anywhere (console or artifacts). Error paths print
 * only `code` / `name`, never `.message` (it can embed the host).
 *
 * The SQL text captured and EXPLAIN'd is pg-delta's OWN catalog SQL (built
 * from `src/extract/**`) — nonsecret, and safe to print/write in full.
 *
 * Artifacts land in `.bench-artifacts/explain/<n>-<slug>.json` (gitignored).
 *
 * Read-only guarantee: the capture pass is production extraction (already a
 * REPEATABLE READ READ ONLY transaction that always ROLLBACKs on non-error
 * paths... actually COMMITs, but performs no writes). The EXPLAIN pass runs
 * inside its own REPEATABLE READ READ ONLY transaction and always ROLLBACKs.
 * No apply/prove machinery is imported.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { resolveProfile, supabaseProfile } from "../src/integrations/index.ts";

// ── constants ───────────────────────────────────────────────────────────────

const POOL_MAX = 2;
const APP_NAME = "pgdelta-bench-explain";
const DEFAULT_ENV_VAR = "PGDELTA_BENCH_SOURCE_URL";
const DEFAULT_TOP = 8;
const DEFAULT_STATEMENT_TIMEOUT_MS = 120_000;
const LABEL_SQL_MAX = 50;

// Statements that are session/transaction plumbing, not catalog SELECTs —
// dropped before ranking. Case-insensitive, matched against the trimmed head.
const NON_QUERY_PREFIXES =
  /^\s*(BEGIN|COMMIT|ROLLBACK|SET|SHOW|SELECT\s+set_config\s*\(|SELECT\s+pg_export_snapshot\s*\()/i;

// ── options ─────────────────────────────────────────────────────────────────

export interface ExplainOptions {
  envVar: string;
  top: number;
  statementTimeoutMs: number;
}

export const DEFAULT_OPTIONS: ExplainOptions = {
  envVar: DEFAULT_ENV_VAR,
  top: DEFAULT_TOP,
  statementTimeoutMs: DEFAULT_STATEMENT_TIMEOUT_MS,
};

export class ExplainUsageError extends Error {}

const USAGE = `Usage: ${DEFAULT_ENV_VAR}=<url> bun scripts/explain-top-queries.ts \\
    [--env-var NAME] [--top <n>] [--statement-timeout <ms>]

Connection string is read ONLY from the environment (default env var:
${DEFAULT_ENV_VAR}; override with --env-var, which must start with PGDELTA_).`;

export function parseExplainArgs(argv: string[]): ExplainOptions {
  const options: ExplainOptions = { ...DEFAULT_OPTIONS };
  const value = (index: number, flag: string): string => {
    const raw = argv[index];
    if (raw === undefined) {
      throw new ExplainUsageError(`${flag} requires a value`);
    }
    return raw;
  };
  const positive = (raw: string, flag: string): number => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new ExplainUsageError(
        `${flag} must be a positive number (got: ${raw})`,
      );
    }
    return Math.floor(parsed);
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case "--env-var": {
        const name = value(++i, arg);
        if (!name.startsWith("PGDELTA_")) {
          throw new ExplainUsageError(
            `--env-var must name a PGDELTA_* variable (got: ${name})`,
          );
        }
        options.envVar = name;
        break;
      }
      case "--top":
        options.top = positive(value(++i, arg), arg);
        break;
      case "--statement-timeout":
        options.statementTimeoutMs = positive(value(++i, arg), arg);
        break;
      case "--help":
      case "-h":
        throw new ExplainUsageError("help");
      default:
        // A connection string passed positionally is exactly what this script
        // refuses to accept — say so instead of a generic "unknown flag".
        throw new ExplainUsageError(
          `unknown argument "${arg}" — the connection string must come from ` +
            `the environment (${DEFAULT_ENV_VAR} by default), never argv`,
        );
    }
  }
  return options;
}

function readConnection(envVar: string): string {
  const url = process.env[envVar];
  if (url === undefined || url === "") {
    throw new ExplainUsageError(
      `missing required environment variable: ${envVar}`,
    );
  }
  return url;
}

/** SQLSTATE only of a driver error — never `.message` (it can embed host). */
function errorCode(error: unknown): string | undefined {
  if (error !== null && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

function errorName(error: unknown): string {
  if (error instanceof Error) return error.name;
  return typeof error;
}

// ── per-query capture (mirrors scripts/benchmark-remote.ts::attachQueryProbe) ─

interface CapturedQuery {
  sql: string;
  ms: number;
  rows: number;
  ok: boolean;
  code?: string;
}

const WRAPPED = Symbol("pgdelta-explain-wrapped");

function sqlTextOf(first: unknown): string {
  if (typeof first === "string") return first;
  if (first !== null && typeof first === "object") {
    const text = (first as { text?: unknown }).text;
    if (typeof text === "string") return text;
  }
  return "";
}

/** Catalog relation name + a short prefix — same heuristic as
 *  benchmark-remote.ts::queryLabel, used here only for the console label. */
function queryLabel(sql: string): string {
  const flat = sql.replace(/\s+/g, " ").trim();
  const from = /\bFROM\s+(?:pg_catalog\.)?(\w+)/i.exec(flat);
  return `${from?.[1] ?? "?"} | ${flat.slice(0, LABEL_SQL_MAX)}`;
}

function slugOf(sql: string): string {
  const flat = sql.replace(/\s+/g, " ").trim();
  const from = /\bFROM\s+(?:pg_catalog\.)?(\w+)/i.exec(flat);
  const base = from?.[1] ?? "query";
  return base.toLowerCase().replace(/[^a-z0-9_]+/g, "-");
}

/**
 * Wrap `pool.connect` so every checked-out client's `query` is timed and its
 * full SQL text recorded, then hand back a detach function that restores BOTH
 * `pool.connect` and every client it wrapped. Measurement only — mirrors
 * scripts/benchmark-remote.ts::attachQueryProbe, handling both the promise and
 * callback overloads of `client.query` (the latter is what `pool.query` uses
 * internally, and `resolveProfile` calls `pool.query` directly).
 */
function attachQueryProbe(pool: pg.Pool, sink: CapturedQuery[]): () => void {
  const originalConnect = pool.connect.bind(pool);
  const wrappedClients: Array<{
    client: pg.PoolClient;
    descriptor: PropertyDescriptor | undefined;
  }> = [];

  const wrapClient = (client: pg.PoolClient | undefined): void => {
    if (client === undefined) return;
    const slot = client as unknown as Record<symbol, unknown>;
    if (slot[WRAPPED] === true) return;
    slot[WRAPPED] = true;
    const originalQuery = client.query.bind(client) as (
      ...args: unknown[]
    ) => unknown;
    wrappedClients.push({
      client,
      descriptor: Object.getOwnPropertyDescriptor(client, "query"),
    });
    (client as { query: unknown }).query = (...args: unknown[]) => {
      const start = performance.now();
      const returned = originalQuery(...args);
      // pg's client.query has a callback overload that returns void, not a
      // promise (pg-pool uses it internally) — only time the promise form.
      if (
        returned == null ||
        typeof (returned as { then?: unknown }).then !== "function"
      ) {
        return returned;
      }
      const sql = sqlTextOf(args[0]);
      return (
        returned as Promise<{ rows: unknown[] } | { rows: unknown[] }[]>
      ).then(
        (result) => {
          // The session-setup batch (src/extract/scope.ts::makeBatchRunner)
          // sends a multi-statement string over the simple query protocol, and
          // node-pg resolves those with an ARRAY of per-statement results
          // instead of one result object — sum rows across them. That batch's
          // SQL starts with BEGIN/SET, so NON_QUERY_PREFIXES already excludes
          // it from EXPLAIN ranking below regardless of its row count.
          const rows = Array.isArray(result)
            ? result.reduce((sum, one) => sum + one.rows.length, 0)
            : result.rows.length;
          sink.push({
            sql,
            ms: performance.now() - start,
            rows,
            ok: true,
          });
          return result;
        },
        (error: unknown) => {
          const code = errorCode(error);
          sink.push({
            sql,
            ms: performance.now() - start,
            rows: 0,
            ok: false,
            ...(code !== undefined ? { code } : {}),
          });
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

  return () => {
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
}

// ── EXPLAIN JSON shape (subset we actually read) ───────────────────────────

interface PlanNode {
  "Node Type"?: string;
  "Relation Name"?: string;
  Alias?: string;
  "Actual Total Time"?: number;
  "Actual Loops"?: number;
  "Actual Rows"?: number;
  Plans?: PlanNode[];
  [key: string]: unknown;
}

interface ExplainPlan {
  Plan: PlanNode;
  "Planning Time"?: number;
  "Execution Time"?: number;
  [key: string]: unknown;
}

function flattenNodes(node: PlanNode, acc: PlanNode[] = []): PlanNode[] {
  acc.push(node);
  for (const child of node.Plans ?? []) flattenNodes(child, acc);
  return acc;
}

/** EXPLAIN BUFFERS counters are INCLUSIVE of every child node already — the
 *  root node's count IS the query total, so summing recursively across the
 *  tree double- (triple-, ...) counts every buffer touched below the root.
 *  Actual Total Time is inclusive the same way, and the topNodes display
 *  above already treats it as such (no summing there either). */
function rootBuffers(
  plan: PlanNode,
  key: "Shared Hit Blocks" | "Shared Read Blocks",
): number {
  return (plan[key] as number | undefined) ?? 0;
}

/** Postgres reports `Actual Total Time` PER LOOP, not summed across
 *  executions — a 1ms node with 1000 loops (e.g. the inner side of a nested
 *  loop join) did ~1000ms of real work despite looking cheap. Multiply by
 *  `Actual Loops` to rank/report the node's actual total contribution. */
function nodeTotalMs(node: PlanNode): number {
  const time = node["Actual Total Time"] ?? 0;
  const loops = node["Actual Loops"] ?? 1;
  return time * loops;
}

function describeNode(node: PlanNode): string {
  const type = node["Node Type"] ?? "?";
  const relation = node["Relation Name"] ?? node["Alias"];
  const time = node["Actual Total Time"] ?? 0;
  const loops = node["Actual Loops"] ?? 1;
  const detail = `total≈${nodeTotalMs(node).toFixed(1)}ms = ${time.toFixed(1)}ms x ${loops} loops`;
  return relation !== undefined
    ? `${type} on ${relation} (${detail})`
    : `${type} (${detail})`;
}

// ── the run ─────────────────────────────────────────────────────────────────

interface RankedQuery {
  sql: string;
  captureMs: number;
  rows: number;
}

async function main(options: ExplainOptions): Promise<void> {
  const url = readConnection(options.envVar);
  const artifactsDir = fileURLToPath(
    new URL("../.bench-artifacts/explain/", import.meta.url),
  );
  mkdirSync(artifactsDir, { recursive: true });

  const pool = new pg.Pool({
    connectionString: url,
    max: POOL_MAX,
    application_name: APP_NAME,
  });
  pool.on("error", () => {});

  // The entire pool lifetime lives inside this try/finally so ANY rejection
  // below — resolveProfile, the capture extraction (e.g. a statement
  // timeout), or the EXPLAIN pass itself — still ends the pool instead of
  // leaking live sockets back to the `catch` in the CLI entry below.
  try {
    const captured: CapturedQuery[] = [];
    const detach = attachQueryProbe(pool, captured);

    console.log(
      `capturing production extraction (source: env ${options.envVar})...`,
    );

    try {
      const resolved = await resolveProfile(pool, supabaseProfile, {
        redactSecrets: true,
      });
      await resolved.extract(pool, {
        redactSecrets: true,
        statementTimeoutMs: options.statementTimeoutMs,
      });
    } finally {
      detach();
    }

    console.log(`captured ${captured.length} queries; ranking...`);

    // Rank: drop transaction-control/settings statements, keep the rest, sort
    // by client ms desc, take the top N.
    const candidates = captured.filter(
      (q) => q.ok && !NON_QUERY_PREFIXES.test(q.sql.trim()),
    );
    const ranked: RankedQuery[] = candidates
      .map((q) => ({ sql: q.sql, captureMs: q.ms, rows: q.rows }))
      .sort((a, b) => b.captureMs - a.captureMs)
      .slice(0, options.top);

    if (ranked.length === 0) {
      console.log("no candidate queries found to EXPLAIN");
      return;
    }

    console.log(
      `EXPLAINing top ${ranked.length} quer${ranked.length === 1 ? "y" : "ies"}...`,
    );

    const client = await pool.connect();
    let trackIoTiming = "unknown";
    // A fatal pass-level failure (e.g. session setup after client acquisition)
    // is caught below so best-effort rollback/cleanup + the partial report still
    // run, but it must not let the process exit 0 — rethrown at the end of
    // `main` once cleanup is done. Individual per-query failures are already
    // savepoint-isolated (see the try/catch inside the loop) and never set this.
    let fatalError: unknown;
    const rows: Array<{
      label: string;
      captureMs: number;
      executionMs: number | null;
      planningMs: number | null;
      sharedHit: number | null;
      sharedRead: number | null;
      actualRows: number | null;
      topNodes: string[];
      error: { code: string | undefined; name: string } | null;
    }> = [];

    try {
      // Reproduce extraction's exact session semantics (src/extract/extract.ts
      // lines ~104-186): REPEATABLE READ READ ONLY, pinned search_path, JIT
      // disabled, optional statement_timeout. Never COMMIT — always ROLLBACK.
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await client.query("SET LOCAL search_path TO 'pg_catalog'");
      await client.query(
        `SET LOCAL statement_timeout = ${Math.max(0, Math.floor(options.statementTimeoutMs))}`,
      );

      const versionRow = (
        await client.query(
          `SELECT current_setting('server_version_num')::int AS num`,
        )
      ).rows[0];
      const pgMajor = Math.floor(Number(versionRow?.["num"] ?? 0) / 10000);
      await client.query(
        pgMajor >= 15
          ? "SELECT set_config('jit', 'off', true) WHERE has_parameter_privilege(current_user, 'jit', 'SET')"
          : "SET LOCAL jit = off",
      );

      const trackIoRow = (await client.query("SHOW track_io_timing")).rows[0];
      trackIoTiming = String(trackIoRow?.["track_io_timing"] ?? "unknown");

      for (let i = 0; i < ranked.length; i++) {
        const query = ranked[i]!;
        const label = queryLabel(query.sql);
        const slug = slugOf(query.sql);
        const filename = `${i + 1}-${slug}.json`;

        // A failed EXPLAIN (e.g. statement_timeout firing on a heavy query)
        // aborts the shared transaction — every later query would then fail with
        // 25P02 (in_failed_sql_transaction) instead of its own error. A SAVEPOINT
        // around each EXPLAIN scopes the damage to just that one query.
        try {
          await client.query("SAVEPOINT q");
          const explainResult = await client.query(
            `EXPLAIN (ANALYZE, BUFFERS, SETTINGS, FORMAT JSON) ${query.sql}`,
          );
          await client.query("RELEASE SAVEPOINT q");
          const plan = (
            explainResult.rows[0] as { "QUERY PLAN": ExplainPlan[] }
          )["QUERY PLAN"][0]!;
          const allNodes = flattenNodes(plan.Plan);
          const topNodes = [...allNodes]
            .sort((a, b) => nodeTotalMs(b) - nodeTotalMs(a))
            .slice(0, 3)
            .map(describeNode);

          writeFileSync(
            `${artifactsDir}${filename}`,
            JSON.stringify(
              { sql: query.sql, captureMs: query.captureMs, plan },
              null,
              2,
            ),
            "utf8",
          );

          rows.push({
            label,
            captureMs: query.captureMs,
            executionMs: plan["Execution Time"] ?? null,
            planningMs: plan["Planning Time"] ?? null,
            sharedHit: rootBuffers(plan.Plan, "Shared Hit Blocks"),
            sharedRead: rootBuffers(plan.Plan, "Shared Read Blocks"),
            actualRows: plan.Plan["Actual Rows"] ?? null,
            topNodes,
            error: null,
          });
        } catch (error) {
          // Roll back to the savepoint so the shared transaction stays usable for
          // the remaining ranked queries — a bare catch here would leave it
          // aborted and every subsequent EXPLAIN would fail with 25P02.
          await client.query("ROLLBACK TO SAVEPOINT q").catch(() => {});
          rows.push({
            label,
            captureMs: query.captureMs,
            executionMs: null,
            planningMs: null,
            sharedHit: null,
            sharedRead: null,
            actualRows: null,
            topNodes: [],
            error: { code: errorCode(error), name: errorName(error) },
          });
          writeFileSync(
            `${artifactsDir}${filename}`,
            JSON.stringify(
              {
                sql: query.sql,
                captureMs: query.captureMs,
                error: { code: errorCode(error), name: errorName(error) },
              },
              null,
              2,
            ),
            "utf8",
          );
        }
      }

      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      console.error(
        `fatal error during EXPLAIN pass: code=${errorCode(error)} name=${errorName(error)}`,
      );
      fatalError = error;
    } finally {
      client.release();
    }

    // ── console report ─────────────────────────────────────────────────────
    console.log(`\ntrack_io_timing = ${trackIoTiming}\n`);
    console.log(
      `${"#".padStart(3)}  ${"captureMs".padStart(10)}  ${"execMs".padStart(9)}  ` +
        `${"planMs".padStart(8)}  ${"sharedHit".padStart(10)}  ${"sharedRead".padStart(11)}  ` +
        `${"rows".padStart(7)}  label`,
    );
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      if (r.error !== null) {
        console.log(
          `${String(i + 1).padStart(3)}  ${r.captureMs.toFixed(1).padStart(10)}  ` +
            `ERROR code=${r.error.code ?? "?"} name=${r.error.name}  ${r.label}`,
        );
        continue;
      }
      console.log(
        `${String(i + 1).padStart(3)}  ${r.captureMs.toFixed(1).padStart(10)}  ` +
          `${(r.executionMs ?? 0).toFixed(1).padStart(9)}  ${(r.planningMs ?? 0).toFixed(1).padStart(8)}  ` +
          `${String(r.sharedHit ?? 0).padStart(10)}  ${String(r.sharedRead ?? 0).padStart(11)}  ` +
          `${String(r.actualRows ?? 0).padStart(7)}  ${r.label}`,
      );
    }

    console.log("\ntop 3 plan nodes by actual total time x loops, per query:");
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      console.log(`\n[${i + 1}] ${r.label}`);
      if (r.error !== null) {
        console.log(
          `  (errored: code=${r.error.code ?? "?"} name=${r.error.name})`,
        );
        continue;
      }
      for (const node of r.topNodes) console.log(`  ${node}`);
    }

    console.log(`\nartifacts: ${artifactsDir}`);

    // Cleanup (rollback, client release) is done and the partial report is
    // printed — now surface the fatal failure so automation can't mistake an
    // incomplete run for success. `pool.end()` still runs after this throw,
    // in the outer `finally` below.
    if (fatalError !== undefined) {
      throw fatalError;
    }
  } finally {
    // Best-effort: whatever happened above (success, an early `return` on no
    // candidates, a rethrown fatalError, or an exception `resolveProfile` /
    // `extract` never let us catch) must never leave a live pool holding
    // sockets open. Swallow `end()`'s own error too — the original failure (if
    // any) is what should propagate, not a secondary shutdown error.
    await pool.end().catch(() => {});
  }
}

// ── CLI entry ───────────────────────────────────────────────────────────────

if (import.meta.main) {
  try {
    await main(parseExplainArgs(process.argv.slice(2)));
  } catch (error) {
    if (error instanceof ExplainUsageError) {
      if (error.message !== "help") {
        process.stderr.write(`explain-top-queries: ${error.message}\n\n`);
      }
      process.stderr.write(`${USAGE}\n`);
      process.exit(1);
    }
    console.error(`fatal: code=${errorCode(error)} name=${errorName(error)}`);
    process.exit(1);
  }
}
