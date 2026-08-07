/**
 * Extraction disables JIT for its catalog queries. `EXPLAIN (ANALYZE)` on the
 * `pg_depend` resolver (src/extract/dependencies.ts) shows an inflated cost
 * estimate that crosses Postgres's default `jit_above_cost`, so the planner
 * JIT-compiles ~467 functions costing ~59% of a warm run — pure per-execution
 * overhead, since catalog queries gain nothing from JIT. `SET LOCAL jit = off`
 * pinned to the extraction transaction removes that overhead without touching
 * the pooled connection outside the transaction.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import { createTestDb, type TestDb } from "./containers.ts";
import type pg from "pg";

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb("extract-jit-off");
  await db.pool.query(`
    CREATE SCHEMA app;
    CREATE TABLE app.t (id integer PRIMARY KEY, v text DEFAULT 'x');
  `);
}, 120_000);

afterAll(async () => {
  await db.drop();
});

/** Wrap the next-checked-out client's `query` to record every statement text,
 *  run `fn`, then restore `pool.connect`. Mirrors the monkeypatch pattern in
 *  scripts/benchmark.ts's `withPerQueryTiming` — measurement only, never
 *  touches the library. */
async function withQueryLog<T>(
  pool: pg.Pool,
  fn: () => Promise<T>,
): Promise<{ result: T; statements: string[] }> {
  const statements: string[] = [];
  const origConnect = pool.connect.bind(pool);
  (pool as { connect: unknown }).connect = async (...args: unknown[]) => {
    const client = await (
      origConnect as (...a: unknown[]) => Promise<pg.PoolClient>
    )(...args);
    const origQuery = client.query.bind(client) as (...a: unknown[]) => unknown;
    (client as { query: unknown }).query = (...qa: unknown[]) => {
      const sql = typeof qa[0] === "string" ? qa[0] : String(qa[0]);
      statements.push(sql);
      return origQuery(...qa);
    };
    return client;
  };
  try {
    const result = await fn();
    return { result, statements };
  } finally {
    (pool as { connect: unknown }).connect = origConnect;
  }
}

describe("extract: jit disabled for extraction transaction", () => {
  test("pins `SET LOCAL jit = off` exactly once", async () => {
    const { statements } = await withQueryLog(db.pool, () => extract(db.pool));
    const jitOffStatements = statements.filter((s) =>
      /SET LOCAL jit = off/i.test(s),
    );
    expect(jitOffStatements).toHaveLength(1);
  }, 60_000);
});
