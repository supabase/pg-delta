/**
 * Regression coverage for Unit B + Codex #329 (comment 3573438706): body
 * validation leniency in seeded schemas must be scoped to the routines the
 * Phase 2b seed ACTUALLY created (by full overload-safe identity, and only
 * while the body is unchanged) — NOT to every routine that happens to live in
 * a seeded schema NAME.
 *
 * Under `--profile supabase`, the shadow is pre-seeded with ~900 platform
 * objects (`options.seededSchemas` + `options.seededRoutines`) before the
 * user's SQL files load. The post-load body-validation pass re-validates
 * routines with `check_function_bodies = on`:
 *   - a SEEDED platform routine with an imperfect reconstruction must warn, so
 *     an engine bug in platform-code reconstruction doesn't abort the user's
 *     apply on code the user doesn't own;
 *   - a USER-authored routine — including a new overload of a seeded name, or a
 *     CREATE OR REPLACE of a seeded routine — must still THROW, because the
 *     user owns it and (being reference-only assumed-schema state in the diff)
 *     it would otherwise be a silent no-op.
 *
 * Cases:
 *   1. broken routine that IS in the seed set (identity + unchanged def) warns.
 *   2. broken routine OUTSIDE any seeded schema throws (backward compat, no
 *      `seededRoutines` option passed).
 *   A. user-authored broken routine in a seeded schema (empty seed set) throws.
 *   B. broken NEW OVERLOAD of a seeded routine name throws.
 *   C. broken CREATE OR REPLACE of a seeded routine throws.
 */
import { describe, expect, test } from "bun:test";
import { encodeId, type StableId } from "../src/core/stable-id.ts";
import {
  loadSqlFiles,
  ShadowLoadError,
} from "../src/frontends/load-sql-files.ts";
import { createTestDb } from "./containers.ts";
import type { PoolClient } from "pg";

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

/** Mirror production (`deriveAssumedSchemaSeed`): build the encodedId -> def map
 *  for every function/procedure in a pre-seeded schema, using the SAME
 *  `format_type(proargtypes)` identity-args expression extraction uses, so the
 *  encoded ids reconstruct byte-for-byte. */
async function seededRoutinesOf(
  client: PoolClient,
  schema: string,
): Promise<Map<string, string>> {
  const res = await client.query(
    `
    SELECT p.proname AS name, p.prokind AS prokind,
           ARRAY(SELECT format_type(t.t, NULL)
                 FROM unnest(p.proargtypes) WITH ORDINALITY AS t(t, ord)
                 ORDER BY t.ord)::text[] AS args,
           pg_get_functiondef(p.oid) AS def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = $1 AND p.prokind IN ('f', 'p')`,
    [schema],
  );
  const map = new Map<string, string>();
  for (const r of res.rows as {
    name: string;
    prokind: string;
    args: string[];
    def: string;
  }[]) {
    const id: StableId = {
      kind: r.prokind === "p" ? "procedure" : "function",
      schema,
      name: r.name,
      args: r.args.map(String),
    };
    map.set(encodeId(id), r.def);
  }
  return map;
}

describe("loadSqlFiles — seeded-routine body validation scoping", () => {
  test("a broken routine in the seed set warns instead of blocking the load", async () => {
    const shadow = await createTestDb("seededok");
    try {
      // Simulate Phase 2b's pre-seed: a platform schema with a routine whose
      // body is only invalid once check_function_bodies is turned back on.
      const client = await shadow.pool.connect();
      let seededRoutines: Map<string, string>;
      try {
        await client.query("CREATE SCHEMA platform");
        await client.query("SET check_function_bodies = off");
        await client.query(
          "CREATE FUNCTION platform.broken() RETURNS int LANGUAGE sql AS 'SELECT x FROM nonexistent'",
        );
        seededRoutines = await seededRoutinesOf(client, "platform");
      } finally {
        await client.query("RESET check_function_bodies").catch(() => {});
        client.release();
      }

      const result = await loadSqlFiles(
        [
          {
            name: "01_table.sql",
            sql: "CREATE TABLE public.t (id integer PRIMARY KEY);",
          },
        ],
        shadow.pool,
        { seededSchemas: ["platform"], seededRoutines },
      );

      const warning = result.diagnostics.find(
        (d) => d.code === "invalid_seeded_routine_body",
      );
      expect(warning).toBeDefined();
      expect(warning?.severity).toBe("warning");
      expect(warning?.message.startsWith("platform.broken:")).toBe(true);
    } finally {
      await shadow.drop();
    }
  }, 60_000);

  // A broken USER routine outside any seeded schema is lenient by DEFAULT: the
  // load proceeds and the failure surfaces as a loud warning (Postgres accepted
  // it under check-off, which pg-delta's own apply executor uses). Under the
  // `strictFunctionBodies` opt-in it goes back to a fatal throw.
  test("a broken routine outside seeded schemas warns by default, and the diagnostic names it", async () => {
    const shadow = await createTestDb("seededbad");
    try {
      const result = await loadSqlFiles(
        [
          {
            name: "01_fn.sql",
            sql: "CREATE FUNCTION public.user_broken() RETURNS int LANGUAGE sql AS 'SELECT x FROM nonexistent';",
          },
        ],
        shadow.pool,
      );
      const warning = result.diagnostics.find(
        (d) => d.code === "invalid_routine_body",
      );
      expect(warning).toBeDefined();
      expect(warning?.severity).toBe("warning");
      expect(warning?.message).toContain("public.user_broken:");
      expect(warning?.message).toContain("nonexistent");
    } finally {
      await shadow.drop();
    }
  }, 60_000);

  test("a broken routine outside seeded schemas still throws under strictFunctionBodies", async () => {
    const shadow = await createTestDb("seededbadstrict");
    try {
      const err = await captureError(
        loadSqlFiles(
          [
            {
              name: "01_fn.sql",
              sql: "CREATE FUNCTION public.user_broken() RETURNS int LANGUAGE sql AS 'SELECT x FROM nonexistent';",
            },
          ],
          shadow.pool,
          { strictFunctionBodies: true },
        ),
      );
      expect(err).toBeInstanceOf(ShadowLoadError);
      const shadowErr = err as ShadowLoadError;
      const detail = shadowErr.details.find(
        (d) => d.code === "invalid_routine_body",
      );
      expect(detail).toBeDefined();
      expect(detail?.severity).toBe("error");
      expect(detail?.message).toContain("public.user_broken:");
      expect(detail?.message).toContain("nonexistent");
    } finally {
      await shadow.drop();
    }
  }, 60_000);

  // Case A — the Codex #329 hole: a USER-authored broken routine in a seeded
  // schema NAME (but absent from the seed set) must throw, not warn.
  test("a user-authored broken routine in a seeded schema (empty seed set) throws", async () => {
    const shadow = await createTestDb("seedhole");
    try {
      const client = await shadow.pool.connect();
      try {
        await client.query("CREATE SCHEMA platform");
      } finally {
        client.release();
      }

      const err = await captureError(
        loadSqlFiles(
          [
            {
              name: "01_fn.sql",
              sql: "CREATE FUNCTION platform.user_broken() RETURNS int LANGUAGE sql AS 'SELECT x FROM nonexistent';",
            },
          ],
          shadow.pool,
          { seededSchemas: ["platform"], seededRoutines: new Map() },
        ),
      );
      expect(err).toBeInstanceOf(ShadowLoadError);
      const detail = (err as ShadowLoadError).details.find(
        (d) => d.code === "invalid_routine_body",
      );
      expect(detail).toBeDefined();
      expect(detail?.message).toContain("platform.user_broken:");
    } finally {
      await shadow.drop();
    }
  }, 60_000);

  // Case B — a broken NEW OVERLOAD of a seeded routine name must throw: the
  // seeded `platform.f(int)` is in the seed set, but `platform.f(text)` is the
  // user's own object (a distinct stable id).
  test("a broken new overload of a seeded routine name throws", async () => {
    const shadow = await createTestDb("seedoverload");
    try {
      const client = await shadow.pool.connect();
      let seededRoutines: Map<string, string>;
      try {
        await client.query("CREATE SCHEMA platform");
        await client.query(
          "CREATE FUNCTION platform.f(a integer) RETURNS int LANGUAGE sql AS 'SELECT 1'",
        );
        seededRoutines = await seededRoutinesOf(client, "platform");
      } finally {
        client.release();
      }

      const err = await captureError(
        loadSqlFiles(
          [
            {
              name: "01_overload.sql",
              sql: "CREATE FUNCTION platform.f(a text) RETURNS int LANGUAGE sql AS 'SELECT x FROM nonexistent';",
            },
          ],
          shadow.pool,
          { seededSchemas: ["platform"], seededRoutines },
        ),
      );
      expect(err).toBeInstanceOf(ShadowLoadError);
      const detail = (err as ShadowLoadError).details.find(
        (d) => d.code === "invalid_routine_body",
      );
      expect(detail).toBeDefined();
      expect(detail?.message).toContain("platform.f:");
    } finally {
      await shadow.drop();
    }
  }, 60_000);

  // Case C — a broken CREATE OR REPLACE of a seeded routine must throw: the
  // identity matches the seed set, but the body has changed (def mismatch), so
  // it is the user's code now.
  test("a broken CREATE OR REPLACE of a seeded routine throws", async () => {
    const shadow = await createTestDb("seedreplace");
    try {
      const client = await shadow.pool.connect();
      let seededRoutines: Map<string, string>;
      try {
        await client.query("CREATE SCHEMA platform");
        await client.query(
          "CREATE FUNCTION platform.f(a integer) RETURNS int LANGUAGE sql AS 'SELECT 1'",
        );
        seededRoutines = await seededRoutinesOf(client, "platform");
      } finally {
        client.release();
      }

      const err = await captureError(
        loadSqlFiles(
          [
            {
              name: "01_replace.sql",
              sql: "CREATE OR REPLACE FUNCTION platform.f(a integer) RETURNS int LANGUAGE sql AS 'SELECT x FROM nonexistent';",
            },
          ],
          shadow.pool,
          { seededSchemas: ["platform"], seededRoutines },
        ),
      );
      expect(err).toBeInstanceOf(ShadowLoadError);
      const detail = (err as ShadowLoadError).details.find(
        (d) => d.code === "invalid_routine_body",
      );
      expect(detail).toBeDefined();
      expect(detail?.message).toContain("platform.f:");
    } finally {
      await shadow.drop();
    }
  }, 60_000);
});
