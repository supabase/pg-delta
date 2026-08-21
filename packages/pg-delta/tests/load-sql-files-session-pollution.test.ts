/**
 * Reconnect-on-stuck: a committed SET ROLE pollutes the session the way
 * ROLLBACK cannot undo. Stock Postgres — no supautils.
 */
import { describe, expect, test } from "bun:test";
import {
  loadSqlFiles,
  ShadowLoadError,
} from "../src/frontends/load-sql-files.ts";
import { createTestDb } from "./containers.ts";

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

/** PG 14 still grants CREATE on `public` to PUBLIC; a locked schema fails
 *  SET ROLE the same way on every supported version. */
async function lockSchemaForRole(
  pool: { query: (sql: string) => Promise<unknown> },
  role: string,
  schema: string,
): Promise<void> {
  await pool.query(`CREATE ROLE ${role} NOLOGIN`);
  await pool.query(`CREATE SCHEMA ${schema}`);
  await pool.query(`REVOKE ALL ON SCHEMA ${schema} FROM PUBLIC`);
  await pool.query(`REVOKE ALL ON SCHEMA ${schema} FROM ${role}`);
}

describe("loadSqlFiles — connectionReuse", () => {
  test("reconnect-on-stuck warns and finishes after SET ROLE pollution", async () => {
    const shadow = await createTestDb("pollute_reconnect");
    try {
      await lockSchemaForRole(shadow.pool, "load_weak", "locked");
      const warnings: string[] = [];
      const result = await loadSqlFiles(
        [
          { name: "00_set.sql", sql: "SET ROLE load_weak;" },
          { name: "01_table.sql", sql: "CREATE TABLE locked.t (id integer);" },
        ],
        shadow.pool,
        {
          connectionReuse: "reconnect-on-stuck",
          reorderOnFailure: false,
          onWarning: (m) => warnings.push(m),
        },
      );
      expect(
        result.factBase.has({ kind: "table", schema: "locked", name: "t" }),
      ).toBe(true);
      expect(
        result.diagnostics.some((d) => d.code === "session_pollution"),
      ).toBe(true);
      const pollution = result.diagnostics.find(
        (d) => d.code === "session_pollution",
      );
      expect(pollution?.message).toMatchInlineSnapshot(`
        "New connection unblocked a stuck load (session poisoning).
          stuck 01_table.sql:1 CREATE TABLE locked.t (id integer) (permission denied for schema locked)
          earlier 00_set.sql:1 SET ROLE load_weak
        Remove session-setting statements from declarative SQL, or do not share that session with later DDL."
      `);
      expect(warnings.join("\n")).toEqual(pollution?.message ?? "");
      expect(pollution?.context).toMatchInlineSnapshot(`
        {
          "earlier": [
            {
              "excerpt": "SET ROLE load_weak",
              "file": "00_set.sql",
              "line": 1,
            },
          ],
          "failures": [
            {
              "error": "permission denied for schema locked",
              "excerpt": "CREATE TABLE locked.t (id integer)",
              "file": "01_table.sql",
              "line": 1,
            },
          ],
          "files": [
            "01_table.sql",
          ],
        }
      `);
    } finally {
      await shadow.pool.query(`DROP ROLE IF EXISTS load_weak`).catch(() => {});
      await shadow.drop();
    }
  }, 60_000);

  test("connectionReuse keep throws stuck without a second connect", async () => {
    const shadow = await createTestDb("pollute_keep");
    try {
      await lockSchemaForRole(shadow.pool, "load_weak_keep", "locked");
      const err = await captureError(
        loadSqlFiles(
          [
            { name: "00_set.sql", sql: "SET ROLE load_weak_keep;" },
            {
              name: "01_table.sql",
              sql: "CREATE TABLE locked.t (id integer);",
            },
          ],
          shadow.pool,
          { connectionReuse: "keep", reorderOnFailure: false },
        ),
      );
      expect(err).toBeInstanceOf(ShadowLoadError);
      expect(
        (err as ShadowLoadError).details.some(
          (d) => d.code === "stuck_statement",
        ),
      ).toBe(true);
      expect(
        (err as ShadowLoadError).details.some(
          (d) => d.code === "session_pollution",
        ),
      ).toBe(false);
    } finally {
      await shadow.pool
        .query(`DROP ROLE IF EXISTS load_weak_keep`)
        .catch(() => {});
      await shadow.drop();
    }
  }, 60_000);

  test("does not reconnect while another file in the round still makes progress", async () => {
    const shadow = await createTestDb("pollute_progress");
    try {
      const warnings: string[] = [];
      const result = await loadSqlFiles(
        [
          {
            name: "01_view.sql",
            sql: "CREATE VIEW public.v AS SELECT id FROM public.t;",
          },
          {
            name: "02_table.sql",
            sql: "CREATE TABLE public.t (id integer PRIMARY KEY);",
          },
        ],
        shadow.pool,
        {
          connectionReuse: "reconnect-on-stuck",
          reorderOnFailure: false,
          onWarning: (m) => warnings.push(m),
        },
      );
      expect(
        result.factBase.has({ kind: "view", schema: "public", name: "v" }),
      ).toBe(true);
      expect(warnings.some((w) => /session poisoning/i.test(w))).toBe(false);
      expect(
        result.diagnostics.some((d) => d.code === "session_pollution"),
      ).toBe(false);
    } finally {
      await shadow.drop();
    }
  }, 60_000);
});
