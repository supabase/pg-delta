/**
 * Regression coverage: the post-load body-validation pass in `loadSqlFiles`
 * (`src/frontends/load-sql-files.ts`) must only re-run `sql`/`plpgsql`
 * routines. `check_function_bodies` has no effect on any other language
 * (per the Postgres docs), so re-running e.g. `LANGUAGE internal` routines
 * adds zero validation coverage — and can actively break the load, because
 * `CREATE TYPE ... AS RANGE (...)` auto-creates `LANGUAGE internal`
 * constructor/support functions. A non-superuser role (the production-faithful
 * Supabase case) CAN create the range type itself, but re-running
 * `CREATE OR REPLACE FUNCTION ... LANGUAGE internal` as that same non-superuser
 * fails with `permission denied for language internal`.
 */
import { describe, expect, test } from "bun:test";
import pg from "pg";
import { buildFactBase } from "../src/core/fact.ts";
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

// `loadSqlFiles`'s default extractor (`extract()`) independently queries
// `pg_user_mapping` and fails with "permission denied for table
// pg_user_mapping" for a non-superuser role — a separate, pre-existing bug in
// the extraction path (src/extract/**), out of scope for this fix (which is
// scoped to the body-validation pass only). Stub the extractor so these tests
// isolate the body-validation behavior under test without tripping over that
// unrelated bug.
const stubExtract = async () => ({
  factBase: buildFactBase([], []),
  pgVersion: "test",
  diagnostics: [],
});

/** Build a pool connected AS `role` against the same database as `shadow`. */
function poolAs(shadowUri: string, role: string, password: string): pg.Pool {
  const url = new URL(shadowUri);
  url.username = role;
  url.password = password;
  const pool = new pg.Pool({ connectionString: url.toString(), max: 5 });
  pool.on("error", () => {});
  return pool;
}

describe("loadSqlFiles — body validation is scoped to sql/plpgsql routines", () => {
  test("a non-superuser creating a range type must not have its auto-generated LANGUAGE internal functions re-validated", async () => {
    const shadow = await createTestDb("langscope");
    let valtesterPool: pg.Pool | undefined;
    try {
      const admin = await shadow.pool.connect();
      try {
        await admin.query(
          "CREATE ROLE valtester LOGIN PASSWORD 'x' NOSUPERUSER",
        );
        await admin.query(
          `GRANT CREATE ON DATABASE "${shadow.name}" TO valtester`,
        );
      } finally {
        admin.release();
      }

      valtesterPool = poolAs(shadow.uri, "valtester", "x");

      const files = [
        {
          name: "01_range.sql",
          sql: "CREATE SCHEMA s; CREATE TYPE s.score_range AS RANGE (subtype = numeric);",
        },
      ];

      const result = await loadSqlFiles(files, valtesterPool, {
        extract: stubExtract,
      });
      expect(result).toBeDefined();
    } finally {
      await valtesterPool?.end().catch(() => {});
      await shadow.drop();
      // valtester owns objects only inside the dropped database — the role
      // itself is cluster-global and must be cleaned up separately.
      await shadow.cluster.adminPool
        .query("DROP ROLE IF EXISTS valtester")
        .catch(() => {});
    }
  }, 60_000);

  test("a genuinely broken sql-language routine in the same non-superuser schema still throws", async () => {
    const shadow = await createTestDb("langscope");
    let valtesterPool: pg.Pool | undefined;
    try {
      const admin = await shadow.pool.connect();
      try {
        await admin.query(
          "CREATE ROLE valtester2 LOGIN PASSWORD 'x' NOSUPERUSER",
        );
        await admin.query(
          `GRANT CREATE ON DATABASE "${shadow.name}" TO valtester2`,
        );
      } finally {
        admin.release();
      }

      valtesterPool = poolAs(shadow.uri, "valtester2", "x");

      const files = [
        {
          name: "01_broken.sql",
          sql: "CREATE SCHEMA s; CREATE FUNCTION s.user_broken() RETURNS int LANGUAGE sql AS 'SELECT x FROM nonexistent';",
        },
      ];

      const err = await captureError(
        loadSqlFiles(files, valtesterPool, { extract: stubExtract }),
      );
      expect(err).toBeInstanceOf(ShadowLoadError);
      const shadowErr = err as ShadowLoadError;
      const detail = shadowErr.details.find(
        (d) => d.code === "invalid_routine_body",
      );
      expect(detail).toBeDefined();
      expect(detail?.message).toContain("s.user_broken:");
      expect(detail?.message).toContain("nonexistent");
    } finally {
      await valtesterPool?.end().catch(() => {});
      await shadow.drop();
      await shadow.cluster.adminPool
        .query("DROP ROLE IF EXISTS valtester2")
        .catch(() => {});
    }
  }, 60_000);
});
