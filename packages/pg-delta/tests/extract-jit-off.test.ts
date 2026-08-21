/**
 * Extraction disables JIT for its catalog queries. `EXPLAIN (ANALYZE)` on the
 * `pg_depend` resolver (src/extract/dependencies.ts) shows an inflated cost
 * estimate that crosses Postgres's default `jit_above_cost`, so the planner
 * JIT-compiles ~467 functions costing ~59% of a warm run — pure per-execution
 * overhead, since catalog queries gain nothing from JIT. Pinned to the
 * extraction transaction, this removes that overhead without touching the
 * pooled connection outside the transaction.
 *
 * On PG >= 15 the statement is a privilege-guarded
 * `SELECT set_config('jit', 'off', true) WHERE has_parameter_privilege(...)`
 * rather than a bare `SET LOCAL jit = off`. PG 14 has neither
 * `has_parameter_privilege` nor parameter ACLs, so the plain
 * `SET LOCAL jit = off` is used there unconditionally.
 *
 * IMPORTANT caveat validated while writing this test (empirically, and
 * confirmed by a postgres-hackers note): `jit`'s GUC context is
 * `PGC_USERSET`, and PostgreSQL's parameter-ACL machinery deliberately does
 * NOT gate `PGC_USERSET` parameters at the actual `SET`/`set_config()` call
 * site — only `has_parameter_privilege()` reflects the ACL; the real `SET`
 * ignores it. So a genuine `REVOKE SET ON PARAMETER jit FROM PUBLIC` can
 * never reproduce a permission-denied error for `jit` on stock PostgreSQL —
 * confirmed against real postgres:17-alpine containers while authoring this
 * file: after the revoke, `SET LOCAL jit = off` still succeeds unconditionally
 * for a bare non-superuser role. The guarded form is still the right,
 * transaction-safe shape to ship (JS `try/catch` alone would NOT help here —
 * once ANY statement inside a transaction errors, Postgres marks the whole
 * transaction aborted regardless of the JS-level catch, so the fix must avoid
 * the error at the SQL level, which `has_parameter_privilege` does by
 * construction: it never throws, it returns false), and it protects against
 * environments that DO enforce a stricter policy on `SET` (a managed
 * provider's custom hook, a future PostgreSQL version, or any parameter whose
 * context is not `PGC_USERSET`). The regression test below therefore
 * SIMULATES the permission-denied condition via query interception instead of
 * a real `REVOKE`, since the latter cannot produce it for this parameter.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import pg from "pg";
import { extract, ExtractionTimeoutError } from "../src/extract/extract.ts";
import { createTestDb, sharedCluster, type TestDb } from "./containers.ts";

// Synchronous, derived from the same env var containers.ts keys the container
// image on — needed at module-registration time for `describe.skipIf` below,
// before `beforeAll` (and the actual `cluster.pgMajor()` query) has run.
const PG_MAJOR = Number(
  /postgres:(\d+)/.exec(
    process.env["PGDELTA_TEST_IMAGE"] ?? "postgres:17-alpine",
  )?.[1] ?? "17",
);

let db: TestDb;
let pgMajor: number;

beforeAll(async () => {
  db = await createTestDb("extract-jit-off");
  pgMajor = await (await sharedCluster()).pgMajor();
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

/** Wrap the next-checked-out client so any query whose text matches `pattern`
 *  rejects with the synthetic Postgres error `makeError` builds instead of
 *  reaching the database — every other statement passes through untouched.
 *  Used to simulate error conditions real PostgreSQL cannot reproduce on
 *  demand for `jit` (a REVOKEd SET privilege — see the module comment) or
 *  cannot reproduce deterministically (a statement_timeout firing on exactly
 *  this statement), so the tests exercise the real failure SHAPE — a rejected
 *  statement inside the extraction transaction — directly. */
async function withRejectedStatement<T>(
  pool: pg.Pool,
  pattern: RegExp,
  makeError: () => Error,
  fn: () => Promise<T>,
): Promise<T> {
  const origConnect = pool.connect.bind(pool);
  // Patched clients go BACK into the pool when extract() releases them, so the
  // patch must be undone on exit or a later checkout of the same client would
  // still inject errors into an unrelated test.
  const patched = new Map<pg.PoolClient, unknown>();
  (pool as { connect: unknown }).connect = async (...args: unknown[]) => {
    const client = await (
      origConnect as (...a: unknown[]) => Promise<pg.PoolClient>
    )(...args);
    const origQuery = client.query.bind(client) as (...a: unknown[]) => unknown;
    if (!patched.has(client)) {
      patched.set(client, (client as { query: unknown }).query);
    }
    (client as { query: unknown }).query = (...qa: unknown[]) => {
      const sql = typeof qa[0] === "string" ? qa[0] : String(qa[0]);
      if (pattern.test(sql)) {
        return Promise.reject(makeError());
      }
      return origQuery(...qa);
    };
    return client;
  };
  try {
    return await fn();
  } finally {
    (pool as { connect: unknown }).connect = origConnect;
    for (const [client, query] of patched) {
      (client as { query: unknown }).query = query;
    }
  }
}

/** Synthetic SQLSTATE builder: the message/shape node-pg produces for a server
 *  error with that code, minus the server round trip. */
function pgError(message: string, code: string): () => Error {
  return () => {
    const error = new Error(message) as Error & { code: string };
    error.code = code;
    return error;
  };
}

/** The exact jit-disable statement text for the running cluster's major
 *  version — the guarded `set_config` form on PG >= 15, the bare
 *  `SET LOCAL jit = off` on PG 14. */
const jitOffPattern = (): RegExp =>
  pgMajor >= 15
    ? /SELECT set_config\('jit', 'off', true\) WHERE has_parameter_privilege/i
    : /SET LOCAL jit = off/i;

describe("extract: jit disabled for extraction transaction", () => {
  test("pins the jit-disable statement exactly once", async () => {
    const { statements } = await withQueryLog(db.pool, () => extract(db.pool));
    const pattern = jitOffPattern();
    const jitOffStatements = statements.filter((s) => pattern.test(s));
    expect(jitOffStatements).toHaveLength(1);
  }, 60_000);
});

describe.skipIf(PG_MAJOR < 15)(
  "extract: jit disable degrades gracefully instead of aborting extraction",
  () => {
    test("extract() still succeeds when the jit-disable statement is rejected as permission-denied", async () => {
      // RED (against the pre-fix code, which unconditionally sent the bare
      // `SET LOCAL jit = off` on every PG version): intercepting exactly that
      // literal text and rejecting it reproduces "permission denied to set
      // parameter \"jit\"" inside the extraction's BEGIN...COMMIT — a failed
      // statement poisons the whole Postgres transaction (this is NOT
      // something a JS try/catch alone can undo without a SAVEPOINT), so
      // every subsequent extraction query in the same transaction also
      // fails, and `extract()` rejects entirely.
      //
      // GREEN (after the fix, PG >= 15 only): the real statement sent is the
      // privilege-guarded `SELECT set_config(...) WHERE
      // has_parameter_privilege(...)`, which never appears in `pattern`
      // below, so the interception never fires and extraction proceeds
      // normally. Gated to PG >= 15: on PG 14 the bare statement is still
      // sent unconditionally (parameter ACLs don't exist pre-15, so this
      // whole failure mode is unreachable there in practice — see the module
      // comment), and this synthetic interception would fail there too,
      // which is expected and not a regression.
      const pattern = /^SET LOCAL jit = off$/i;
      const result = await withRejectedStatement(
        db.pool,
        pattern,
        pgError('permission denied to set parameter "jit"', "42501"),
        () => extract(db.pool),
      );
      expect(result.factBase.facts().length).toBeGreaterThan(0);
    }, 60_000);
  },
);

describe("extract: a statement_timeout firing on the jit-disable statement", () => {
  test("surfaces as ExtractionTimeoutError, never as the raw 57014 pg error", async () => {
    // The coordinator's jit-disable is its own round trip (see extract.ts) and
    // runs INSIDE the transaction whose opening batch set the caller's
    // statement_timeout — so a tight budget can fire on exactly this
    // statement. Every other extraction query goes through the timeout-aware
    // runner that maps SQLSTATE 57014 to ExtractionTimeoutError; this pins
    // that the jit-disable round trip gets the identical mapping. A real
    // timeout cannot be aimed at this statement deterministically (which query
    // a 1ms budget cancels first is a race — the CI flake that motivated this
    // test), so the 57014 rejection is injected at the client seam instead.
    let err: unknown;
    try {
      await withRejectedStatement(
        db.pool,
        jitOffPattern(),
        pgError("canceling statement due to statement timeout", "57014"),
        () => extract(db.pool, { statementTimeoutMs: 60_000 }),
      );
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ExtractionTimeoutError);
    const timeout = err as ExtractionTimeoutError;
    expect(timeout.timeoutMs).toBe(60_000);
    expect(timeout.queryLabel.length).toBeGreaterThan(0);
  }, 60_000);
});

describe.skipIf(PG_MAJOR < 15)(
  "extract: jit disable as a plain non-superuser (has_parameter_privilege is false by default)",
  () => {
    let roleName: string | undefined;

    afterAll(async () => {
      if (roleName) {
        const cluster = await sharedCluster();
        await cluster.adminPool
          .query(`DROP ROLE IF EXISTS "${roleName}"`)
          .catch(() => {});
      }
    });

    test("extract() succeeds through a non-superuser connection with zero grants beyond CONNECT", async () => {
      const cluster = await sharedCluster();
      const ts = Date.now();
      roleName = `extract_jit_nsu_${ts}`;
      const password = "extractjitnsupwd";
      await cluster.adminPool.query(
        `CREATE ROLE "${roleName}" LOGIN PASSWORD '${password}' NOSUPERUSER`,
      );

      const uri = db.uri.replace(
        "postgres://test:test@",
        `postgres://${roleName}:${password}@`,
      );
      const pool = new pg.Pool({ connectionString: uri, max: 2 });
      pool.on("error", () => {});
      try {
        // `has_parameter_privilege(current_user, 'jit', 'SET')` is FALSE by
        // default for any non-superuser (confirmed empirically: it mirrors
        // the parameter-ACL "grantor-only" bookkeeping default, not the
        // PGC_USERSET runtime default), so the guarded statement's WHERE
        // clause is false here even with ZERO admin action — the jit-disable
        // is silently skipped, and extraction still succeeds.
        const result = await extract(pool);
        expect(result.factBase.facts().length).toBeGreaterThan(0);
      } finally {
        await pool.end().catch(() => {});
      }
    }, 60_000);
  },
);
