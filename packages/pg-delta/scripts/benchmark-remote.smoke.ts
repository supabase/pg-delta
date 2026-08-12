#!/usr/bin/env bun
/**
 * Smoke test for scripts/benchmark-remote.ts against a LOCAL disposable
 * cluster, so the remote benchmark can be validated end-to-end without any
 * real credentials.
 *
 *   bun scripts/benchmark-remote.smoke.ts
 *
 * It provisions two databases on the shared testcontainers cluster, loads a
 * small schema difference into them (SETUP only — the benchmark itself never
 * writes), exports their URLs as the benchmark's env vars, runs 1 warmup + 2
 * measured iterations, and asserts:
 *
 *   - the JSONL artifact exists and every line parses;
 *   - phase timings are present and positive;
 *   - per-query records exist for BOTH sides;
 *   - the artifact leaks NO connection detail (host, port, user, password, or
 *     database name appears nowhere in it).
 *
 * Requires Docker (see AGENTS.md "Test container hygiene").
 */
import { readFileSync } from "node:fs";
import { sharedCluster } from "../tests/containers.ts";
import {
  type BenchmarkResult,
  DEFAULT_OPTIONS,
  PHASES,
  type QueryRecord,
  type RunRecord,
  runBenchmark,
} from "./benchmark-remote.ts";

const A_SQL = `
  CREATE SCHEMA app;
  CREATE TABLE app.users (id integer PRIMARY KEY, email text NOT NULL);
  CREATE INDEX users_email_idx ON app.users (email);
  CREATE VIEW app.user_ids AS SELECT id FROM app.users;
  CREATE FUNCTION app.bump(a integer) RETURNS integer LANGUAGE sql IMMUTABLE
    AS 'SELECT a + 1';
  COMMENT ON TABLE app.users IS 'smoke';
`;

const B_SQL = `
  CREATE SCHEMA app;
  CREATE TABLE app.users (id integer PRIMARY KEY, email text NOT NULL,
                          created_at timestamptz NOT NULL DEFAULT now());
  CREATE INDEX users_email_idx ON app.users (email);
  CREATE FUNCTION app.bump(a integer) RETURNS integer LANGUAGE sql IMMUTABLE
    AS 'SELECT a + 2';
  CREATE TABLE app.notes (id integer PRIMARY KEY, body text);
`;

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`smoke: ${message}`);
}

/** Best-effort string form of a non-Error thrown value, without relying on a
 *  possibly-useless default `Object.prototype.toString` (`[object Object]`). */
function describeUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value) ?? "(unserializable)";
  } catch {
    return "(unserializable)";
  }
}

/** Replace every redaction needle in `text` with a placeholder — used both for
 *  the artifact-leak assertion below and to scrub a caught error before it is
 *  ever handed to console.error (a pg error's `.message`/`.stack` can embed the
 *  host, port, user, password, or database name). */
function redact(text: string, needles: readonly string[]): string {
  let scrubbed = text;
  for (const needle of needles) {
    scrubbed = scrubbed.split(needle).join("[redacted]");
  }
  return scrubbed;
}

const cluster = await sharedCluster();
const dbA = await cluster.createDb("bench_src");
const dbB = await cluster.createDb("bench_tgt");

// Built once, up front, so BOTH the artifact-leak assertion and the failure
// scrubbing below (which must survive even a connection error) share the same
// needle list. host/port/user/password are identical for A and B (one shared
// container) — only the database name differs.
const urlA = new URL(dbA.uri);
const secrets: Array<[string, string]> = [
  ["host", urlA.hostname],
  ["port", urlA.port],
  ["username", urlA.username],
  ["password", urlA.password],
  ["database A", dbA.name],
  ["database B", dbB.name],
  ["uri A", dbA.uri],
  ["uri B", dbB.uri],
].filter((entry): entry is [string, string] => entry[1] !== "");

let failure: unknown;
try {
  // SETUP writes only — everything below this point is read-only.
  await dbA.pool.query(A_SQL);
  await dbB.pool.query(B_SQL);

  process.env["PGDELTA_BENCH_SOURCE_URL"] = dbA.uri;
  process.env["PGDELTA_BENCH_TARGET_URL"] = dbB.uri;
  process.env["PGDELTA_BENCH_RUN_LABEL"] = "smoke";

  const result: BenchmarkResult = await runBenchmark({
    ...DEFAULT_OPTIONS,
    warmups: 1,
    iterations: 2,
  });

  // ── artifact parses ──────────────────────────────────────────────────────
  const raw = readFileSync(result.artifactPath, "utf8");
  const lines = raw.split("\n").filter((line) => line !== "");
  const parsed = lines.map((line, i) => {
    try {
      return JSON.parse(line) as { kind: string };
    } catch (error) {
      throw new Error(
        `smoke: artifact line ${i + 1} is not valid JSON: ${String(error)}`,
      );
    }
  });
  const runRecords = parsed.filter((r) => r.kind === "run") as RunRecord[];
  const queryRecords = parsed.filter(
    (r) => r.kind === "query",
  ) as QueryRecord[];
  assert(
    runRecords.length === 3,
    `expected 3 run records, got ${runRecords.length}`,
  );
  assert(
    runRecords.filter((r) => r.warmup).length === 1,
    "expected exactly 1 warmup run record",
  );
  assert(queryRecords.length > 0, "expected per-query records");

  // ── phases present and positive (fresh-pool mode pays every phase) ───────
  for (const run of runRecords) {
    for (const phase of PHASES) {
      const value = run.phases[phase];
      assert(
        typeof value === "number" && value > 0,
        `run ${run.iteration}: phase ${phase} must be > 0 (got ${String(value)})`,
      );
    }
    assert(run.source.facts > 0, "source facts must be > 0");
    assert(run.target.facts > 0, "target facts must be > 0");
    assert(run.actions > 0, "expected a non-empty plan (the schemas differ)");
    assert(run.sqlBytes > 0, "expected rendered SQL bytes");
    assert(run.formatOk, "formatter must not throw on the rendered SQL");
    assert(run.source.queryCount > 0, "source queryCount must be > 0");
    assert(run.target.queryCount > 0, "target queryCount must be > 0");
  }

  // ── per-query records for BOTH sides ─────────────────────────────────────
  for (const side of ["source", "target"] as const) {
    assert(
      queryRecords.some((q) => q.side === side),
      `expected query records for the ${side} side`,
    );
  }

  // ── redaction: no connection detail anywhere in the artifact ─────────────
  for (const [what, needle] of secrets) {
    assert(
      !raw.includes(needle),
      `artifact leaks the connection ${what} ("${needle}")`,
    );
  }
  console.log(
    `\nsmoke OK: ${lines.length} artifact lines, ${runRecords.length} runs, ` +
      `${queryRecords.length} queries, ${secrets.length} redaction needles absent`,
  );

  // ── refuses to run without env ───────────────────────────────────────────
  delete process.env["PGDELTA_BENCH_SOURCE_URL"];
  let refused = false;
  try {
    await runBenchmark({ ...DEFAULT_OPTIONS, warmups: 0, iterations: 1 });
  } catch (error) {
    refused = String(error).includes("PGDELTA_BENCH_SOURCE_URL");
  }
  assert(refused, "expected a usage error when the source env var is missing");
  console.log("smoke OK: refuses to run without PGDELTA_BENCH_SOURCE_URL");
} catch (error) {
  failure = error;
} finally {
  await dbA.drop().catch(() => {});
  await dbB.drop().catch(() => {});
}

if (failure !== undefined) {
  // Never hand the raw `failure` to console — a pg error's message/stack can
  // transitively embed the host/port/user/password/db name (e.g. a connection
  // failure quotes the connection string). Print name/code plus the message
  // and stack with every known needle scrubbed instead.
  const name = failure instanceof Error ? failure.name : typeof failure;
  const code =
    failure !== null && typeof failure === "object" && "code" in failure
      ? String((failure as { code: unknown }).code)
      : undefined;
  const message = redact(
    failure instanceof Error ? failure.message : describeUnknown(failure),
    secrets.map(([, needle]) => needle),
  );
  console.error(
    `smoke failed: name=${name}${code !== undefined ? ` code=${code}` : ""} message=${message}`,
  );
  if (failure instanceof Error && failure.stack !== undefined) {
    console.error(
      redact(
        failure.stack,
        secrets.map(([, needle]) => needle),
      ),
    );
  }
  process.exit(1);
}
process.exit(0);
