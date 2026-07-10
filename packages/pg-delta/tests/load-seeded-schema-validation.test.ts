/**
 * Regression coverage for Unit B: body validation must be scoped to
 * non-seeded schemas. Under `--profile supabase`, the shadow is pre-seeded
 * with ~900 platform objects (`options.seededSchemas`) before the user's SQL
 * files load. The post-load body-validation pass used to re-validate those
 * seeded platform routines too — any imperfection in platform-code
 * reconstruction aborted the user's apply on code the user doesn't own.
 *
 * Case 1: a broken routine INSIDE a seeded schema must warn, not throw.
 * Case 2: a broken routine OUTSIDE any seeded schema must still throw, and
 * the diagnostic must name the failing routine (`schema.name: ...`).
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

describe("loadSqlFiles — seeded-schema body validation scoping", () => {
  test("a broken routine in a seeded schema warns instead of blocking the load", async () => {
    const shadow = await createTestDb("seededok");
    try {
      // Simulate Phase 2b's pre-seed: a platform schema with a routine whose
      // body is only invalid once check_function_bodies is turned back on.
      const client = await shadow.pool.connect();
      try {
        await client.query("CREATE SCHEMA platform");
        await client.query("SET check_function_bodies = off");
        await client.query(
          "CREATE FUNCTION platform.broken() RETURNS int LANGUAGE sql AS 'SELECT x FROM nonexistent'",
        );
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
        { seededSchemas: ["platform"] },
      );

      const warning = result.diagnostics.find(
        (d) => d.code === "invalid_routine_body",
      );
      expect(warning).toBeDefined();
      expect(warning?.severity).toBe("warning");
      expect(warning?.message.startsWith("platform.broken:")).toBe(true);
    } finally {
      await shadow.drop();
    }
  }, 60_000);

  test("a broken routine outside seeded schemas still throws, and the diagnostic names it", async () => {
    const shadow = await createTestDb("seededbad");
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
        ),
      );
      expect(err).toBeInstanceOf(ShadowLoadError);
      const shadowErr = err as ShadowLoadError;
      const detail = shadowErr.details.find(
        (d) => d.code === "invalid_routine_body",
      );
      expect(detail).toBeDefined();
      expect(detail?.message).toContain("public.user_broken:");
      expect(detail?.message).toContain("nonexistent");
    } finally {
      await shadow.drop();
    }
  }, 60_000);
});
