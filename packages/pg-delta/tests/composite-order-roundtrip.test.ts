/**
 * Composite attribute ORDER round-trip (the realtime.wal_rls chain).
 *
 * A composite type declared `(wal jsonb, is_rls_enabled boolean,
 * subscription_ids uuid[], errors text[])` is row-layout state: its attribute
 * ORDER matters. Dependents observe it — a function `RETURNS SETOF wal_rls`
 * feeding a SQL-language function `RETURNS TABLE(wal jsonb, …)` that `SELECT *`s
 * from it validates its body against the composite's column order/types.
 *
 * Before the fix the composite `CREATE TYPE … AS (…)` rendered its attributes
 * in encoded-id (name) order, so `errors` sorted before `wal`. The export
 * silently reordered the columns and the reload's `check_function_bodies = on`
 * pass failed the SQL function with `… returns text[] instead of jsonb at
 * column 1` → `1 routine body failed validation`.
 *
 * After the fix the export preserves declared position, so `load(export(fb))`
 * completes and a re-extract of the shadow hash-matches the source.
 *
 * Stock alpine image; Docker required.
 */
import { describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import { exportSqlFiles } from "../src/frontends/export-sql-files.ts";
import { loadSqlFiles } from "../src/frontends/load-sql-files.ts";
import { sharedCluster } from "./containers.ts";

// declared order is NOT alphabetical: wal < is_rls_enabled < subscription_ids <
// errors (alphabetical would put errors first). The dependent SQL function
// pins that order at body-validation time.
const WAL_RLS_CHAIN_SQL = `
  CREATE SCHEMA s;
  CREATE TYPE s.wal_rls AS (
    wal jsonb,
    is_rls_enabled boolean,
    subscription_ids uuid[],
    errors text[]
  );
  CREATE FUNCTION s.apply_rls() RETURNS SETOF s.wal_rls
    LANGUAGE sql AS $$ SELECT NULL::jsonb, NULL::boolean, NULL::uuid[], NULL::text[] $$;
  CREATE FUNCTION s.list_changes()
    RETURNS TABLE(wal jsonb, is_rls_enabled boolean, subscription_ids uuid[], errors text[])
    LANGUAGE sql AS $$ SELECT * FROM s.apply_rls() $$;
`;

function forLoad(files: { name: string; sql: string }[]) {
  // roles are cluster-global and already present in the shared cluster.
  return files.filter((f) => !/cluster[_/]roles/.test(f.name));
}

describe("composite attribute order round-trip", () => {
  test("wal_rls chain reloads with attributes in declared order", async () => {
    const cluster = await sharedCluster();
    const src = await cluster.createDb("composite_order_src");
    const shadow = await cluster.createDb("composite_order_shadow");
    try {
      await src.pool.query(WAL_RLS_CHAIN_SQL);
      const fb = (await extract(src.pool)).factBase;

      const files = forLoad(exportSqlFiles(fb, { layout: "by-object" }));
      const loaded = await loadSqlFiles(files, shadow.pool);
      expect(loaded.factBase.rootHash).toBe(fb.rootHash);
    } finally {
      await Promise.all([src.drop(), shadow.drop()]);
    }
  }, 120_000);
});
