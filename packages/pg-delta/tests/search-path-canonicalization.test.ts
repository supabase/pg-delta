/**
 * Regression: the extraction session must canonicalize its `search_path` to
 * `pg_catalog` (pg_dump convention). Postgres deparsers (`format_type`,
 * `pg_get_*def`, `pg_get_expr`) path-relativize object names, so a type /
 * function visible on the session path renders UNQUALIFIED. Without pinning,
 * the SAME catalog extracted under different search_paths produces DIFFERENT
 * payloads — mass false drift in the shadow-vs-target compare, and rendered
 * DDL with names that can misresolve under the applier's path.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import pg from "pg";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { createTestDb, type TestDb } from "./containers.ts";

const DDL = /* sql */ `
  CREATE SCHEMA app;
  CREATE TYPE app.addr AS (street text, city text);
  CREATE TABLE public.people (id integer PRIMARY KEY, home app.addr);
  CREATE FUNCTION public.fmt(a app.addr) RETURNS text
    LANGUAGE sql IMMUTABLE AS 'SELECT ($1).street';
`;

// Extract over a dedicated pool whose session search_path is fixed at connect
// time (the `-c search_path=...` startup option is the faithful equivalent of a
// database/role default path a real target may carry).
async function extractWithPath(uri: string, path: string) {
  const pool = new pg.Pool({
    connectionString: uri,
    options: `-c search_path=${path}`,
    max: 2,
  });
  pool.on("error", () => {});
  try {
    return await extract(pool);
  } finally {
    await pool.end().catch(() => {});
  }
}

describe("extraction canonicalizes search_path", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb("sp_canon");
    await db.pool.query(DDL);
  }, 120_000);

  afterAll(async () => {
    await db.drop();
  });

  test("identical rootHash regardless of session search_path", async () => {
    // Same catalog, two divergent session paths. `public,app` puts both user
    // schemas on the path (names deparse UNQUALIFIED); `pg_catalog` alone
    // forces full qualification. They must hash identically.
    const withApp = await extractWithPath(db.uri, "public,app");
    const catalogOnly = await extractWithPath(db.uri, "pg_catalog");
    expect(withApp.factBase.rootHash).toBe(catalogOnly.factBase.rootHash);
  });

  test("rendered create-from-scratch DDL fully qualifies the user type", async () => {
    const empty = await createTestDb("sp_empty");
    try {
      const emptyState = await extract(empty.pool);
      // extract the populated DB on a path where `app` is visible — pre-fix this
      // relativizes `app.addr` to `addr` in the column and function-arg deparse.
      const populated = await extractWithPath(db.uri, "public,app");
      const p = plan(emptyState.factBase, populated.factBase);
      const sqls = p.actions.map((a) => a.sql);
      // the `home` column carries the composite type (emitted as its own
      // ADD COLUMN action); the function references it as an arg type.
      const columnSql = sqls.find((s) => s.includes('"home"'));
      const fnSql = sqls.find((s) => s.includes("fmt"));
      expect(columnSql).toBeDefined();
      expect(fnSql).toBeDefined();
      // both the column type and the function arg type must be schema-qualified
      expect(columnSql).toContain("app.addr");
      expect(fnSql).toContain("app.addr");
    } finally {
      await empty.drop();
    }
  });

  test("schema apply no-op across search_path divergence", async () => {
    // Two identical databases, extracted under divergent session paths — the
    // shadow-vs-target compare. Pre-fix the deparse divergence fabricates drift;
    // post-fix the plan is empty.
    const target = await createTestDb("sp_target");
    const shadow = await createTestDb("sp_shadow");
    try {
      await target.pool.query(DDL);
      await shadow.pool.query(DDL);
      const targetState = await extractWithPath(target.uri, "public,app");
      const shadowState = await extractWithPath(shadow.uri, "public");
      const p = plan(targetState.factBase, shadowState.factBase);
      expect(p.deltas).toHaveLength(0);
    } finally {
      await target.drop();
      await shadow.drop();
    }
  });
});
