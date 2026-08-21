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

describe("loadSqlFiles — connectionReuse", () => {
  test("reconnect-on-stuck warns and finishes after SET ROLE pollution", async () => {
    const shadow = await createTestDb("pollute_reconnect");
    try {
      await shadow.pool.query(`CREATE ROLE load_weak NOLOGIN`);
      const warnings: string[] = [];
      const result = await loadSqlFiles(
        [
          { name: "00_set.sql", sql: "SET ROLE load_weak;" },
          { name: "01_table.sql", sql: "CREATE TABLE public.t (id integer);" },
        ],
        shadow.pool,
        {
          connectionReuse: "reconnect-on-stuck",
          reorderOnFailure: false,
          onWarning: (m) => warnings.push(m),
        },
      );
      expect(
        result.factBase.has({ kind: "table", schema: "public", name: "t" }),
      ).toBe(true);
      expect(
        result.diagnostics.some((d) => d.code === "session_pollution"),
      ).toBe(true);
      expect(warnings.join("\n")).toMatch(/session pollution/i);
      expect(warnings.join("\n")).toContain(
        "https://github.com/supabase/postgres/issues",
      );
    } finally {
      await shadow.pool.query(`DROP ROLE IF EXISTS load_weak`).catch(() => {});
      await shadow.drop();
    }
  }, 60_000);

  test("connectionReuse keep throws stuck without a second connect", async () => {
    const shadow = await createTestDb("pollute_keep");
    try {
      await shadow.pool.query(`CREATE ROLE load_weak_keep NOLOGIN`);
      const err = await captureError(
        loadSqlFiles(
          [
            { name: "00_set.sql", sql: "SET ROLE load_weak_keep;" },
            {
              name: "01_table.sql",
              sql: "CREATE TABLE public.t (id integer);",
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
      expect(warnings.some((w) => /session pollution/i.test(w))).toBe(false);
      expect(
        result.diagnostics.some((d) => d.code === "session_pollution"),
      ).toBe(false);
    } finally {
      await shadow.drop();
    }
  }, 60_000);
});
