/**
 * Shadow loader transactional robustness (hardening Item 6 / review #5):
 * each file applies inside an explicit transaction, so a mid-file failure
 * leaves no partial state and the file retries cleanly; a non-transactional
 * statement (CREATE INDEX CONCURRENTLY) still loads via a raw fallback.
 */
import { describe, expect, test } from "bun:test";
import {
  loadSqlFiles,
  ShadowLoadError,
} from "../src/frontends/load-sql-files.ts";
import { createTestDb } from "./containers.ts";

describe("loadSqlFiles — per-file transactional apply", () => {
  test("a file that fails mid-way leaves no partial state and retries cleanly", async () => {
    const shadow = await createTestDb("shadow_atomic");
    try {
      // 1_a.sql: statement 1 (CREATE TABLE a) succeeds, statement 2 references
      //   b which does not exist yet → the whole file must roll back so that a
      //   is NOT created. Round 2 (after b loads) retries 1_a; if a had leaked
      //   from round 1, the retry would fail with "relation a already exists".
      const result = await loadSqlFiles(
        [
          {
            name: "1_a.sql",
            sql: `CREATE TABLE public.a (id integer PRIMARY KEY);
                  CREATE VIEW public.va AS SELECT id FROM public.b;`,
          },
          {
            name: "2_b.sql",
            sql: `CREATE TABLE public.b (id integer PRIMARY KEY);`,
          },
        ],
        shadow.pool,
      );
      expect(result.rounds).toBeGreaterThan(1);
      expect(
        result.factBase.has({ kind: "table", schema: "public", name: "a" }),
      ).toBe(true);
      expect(
        result.factBase.has({ kind: "view", schema: "public", name: "va" }),
      ).toBe(true);
      expect(
        result.factBase.has({ kind: "table", schema: "public", name: "b" }),
      ).toBe(true);
    } finally {
      await shadow.drop();
    }
  }, 60_000);

  test("a file with an explicit COMMIT is rejected before any DDL is applied", async () => {
    const shadow = await createTestDb("shadow_txn_control");
    try {
      // The COMMIT would end the loader's per-file transaction early, letting
      // table a commit before the (failing) reference to a nonexistent table.
      // The loader must refuse the file outright, leaving the shadow untouched.
      let error: unknown;
      try {
        await loadSqlFiles(
          [
            {
              name: "1_bad.sql",
              sql: `CREATE TABLE public.a (id integer PRIMARY KEY);
                    COMMIT;
                    CREATE TABLE public.b (id integer REFERENCES public.missing);`,
            },
          ],
          shadow.pool,
        );
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(ShadowLoadError);

      // nothing was applied — the shadow is still empty
      const { rows } = await shadow.pool.query(
        `SELECT count(*)::int AS n FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'r'`,
      );
      expect((rows[0] as { n: number }).n).toBe(0);
    } finally {
      await shadow.drop();
    }
  }, 60_000);

  test("round-budget exhaustion throws instead of returning partial state (review P1 #2)", async () => {
    const shadow = await createTestDb("shadow_max_rounds");
    try {
      // A two-round dependency chain: 00_table needs the schema 01_schema
      // creates, so round 1 loads only the schema and round 2 is required for
      // the table. With maxRounds: 1 the loader runs out of budget WITH the
      // table still pending — it must fail loud, never return a fact base that
      // silently omits the table (the partial-state bug).
      let error: unknown;
      try {
        await loadSqlFiles(
          [
            { name: "00_table.sql", sql: `CREATE TABLE app.t (id integer);` },
            { name: "01_schema.sql", sql: `CREATE SCHEMA app;` },
          ],
          shadow.pool,
          { maxRounds: 1 },
        );
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(ShadowLoadError);
      // the error names the still-pending file and carries its last failure
      expect((error as ShadowLoadError).message).toContain("00_table.sql");
    } finally {
      await shadow.drop();
    }
  }, 60_000);

  test("maxRounds: 0 with any file throws before loading anything (review P1 #2)", async () => {
    const shadow = await createTestDb("shadow_zero_rounds");
    try {
      let error: unknown;
      try {
        await loadSqlFiles(
          [{ name: "0_schema.sql", sql: `CREATE SCHEMA app;` }],
          shadow.pool,
          { maxRounds: 0 },
        );
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(ShadowLoadError);
      // nothing was applied — the shadow is still empty
      const { rows } = await shadow.pool.query(
        `SELECT count(*)::int AS n FROM pg_namespace WHERE nspname = 'app'`,
      );
      expect((rows[0] as { n: number }).n).toBe(0);
    } finally {
      await shadow.drop();
    }
  }, 60_000);

  test("a CREATE INDEX CONCURRENTLY file loads via the raw fallback", async () => {
    const shadow = await createTestDb("shadow_concurrently");
    try {
      const result = await loadSqlFiles(
        [
          {
            name: "0_table.sql",
            sql: `CREATE TABLE public.t (id integer PRIMARY KEY, v integer);`,
          },
          {
            name: "1_index.sql",
            sql: `CREATE INDEX CONCURRENTLY t_v_idx ON public.t (v);`,
          },
        ],
        shadow.pool,
      );
      expect(
        result.factBase.has({
          kind: "index",
          schema: "public",
          name: "t_v_idx",
        }),
      ).toBe(true);
    } finally {
      await shadow.drop();
    }
  }, 60_000);

  test("a non-transactional statement outside the allowlist is refused, not silently run", async () => {
    const shadow = await createTestDb("shadow_fallback_deny");
    try {
      // VACUUM raises SQLSTATE 25001 inside a transaction just like CREATE INDEX
      // CONCURRENTLY, but it is not a declarative-schema statement. The raw
      // fallback runs OUTSIDE the per-file transaction, so it must be restricted
      // to CREATE INDEX CONCURRENTLY; any other 25001-raiser must be refused
      // rather than executed unsandboxed against the live cluster.
      let error: unknown;
      try {
        await loadSqlFiles(
          [{ name: "0_vacuum.sql", sql: `VACUUM;` }],
          shadow.pool,
        );
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(ShadowLoadError);
    } finally {
      await shadow.drop();
    }
  }, 60_000);

  test("the 25001 raw fallback does not leak a cluster-global object", async () => {
    const shadow = await createTestDb("shadow_fallback_leak");
    // CREATE DATABASE is cluster-global and non-transactional. On a co-located
    // shadow it would persist on the target's live cluster. It must be refused,
    // and the sibling database must never be created.
    const leak = `pgdelta_fallback_leak_${Date.now().toString(36)}`;
    try {
      let error: unknown;
      try {
        await loadSqlFiles(
          [{ name: "0_db.sql", sql: `CREATE DATABASE ${leak}` }],
          shadow.pool,
        );
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(ShadowLoadError);
      const { rows } = await shadow.pool.query(
        `SELECT count(*)::int AS n FROM pg_database WHERE datname = $1`,
        [leak],
      );
      expect((rows[0] as { n: number }).n).toBe(0);
    } finally {
      // best-effort: if a pre-fix run leaked the database, drop it.
      await shadow.pool
        .query(`DROP DATABASE IF EXISTS "${leak}" WITH (FORCE)`)
        .catch(() => {});
      await shadow.drop();
    }
  }, 60_000);
});
