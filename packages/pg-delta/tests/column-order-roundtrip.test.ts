/**
 * Table column ORDER round-trip.
 *
 * A table declared `(wal jsonb, is_rls_enabled boolean, subscription_ids uuid[],
 * errors text[])` is row-layout state: its column ORDER matters for `SELECT *`,
 * positional INSERTs, and the relation's row type. The root hash is
 * order-BLIND by design (`_position` is `_`-prefixed), so convergence alone
 * cannot observe a reorder — the reloaded database's PHYSICAL column order
 * (pg_attribute.attnum) is what pins it.
 *
 * Before the fix a from-empty `CREATE TABLE` rendered its columns in encoded-id
 * (name) order, so the export reload materialized them alphabetically
 * (`errors, is_rls_enabled, subscription_ids, wal`). After the fix the export
 * preserves declared position, so the shadow reload keeps `wal` first.
 *
 * Stock alpine image; Docker required.
 */
import { describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import { exportSqlFiles } from "../src/frontends/export-sql-files.ts";
import { loadSqlFiles } from "../src/frontends/load-sql-files.ts";
import { sharedCluster } from "./containers.ts";

// declared order is NOT alphabetical: wal < is_rls_enabled < subscription_ids <
// errors (alphabetical would put errors first).
const TABLE_SQL = `
  CREATE SCHEMA s;
  CREATE TABLE s.wal_rls (
    wal jsonb,
    is_rls_enabled boolean,
    subscription_ids uuid[],
    errors text[]
  );
`;

const DECLARED_ORDER = ["wal", "is_rls_enabled", "subscription_ids", "errors"];

function forLoad(files: { name: string; sql: string }[]) {
  // roles are cluster-global and already present in the shared cluster.
  return files.filter((f) => !/cluster[_/]roles/.test(f.name));
}

async function columnOrder(
  pool: import("pg").Pool,
  relation: string,
): Promise<string[]> {
  const res = await pool.query(
    `SELECT attname FROM pg_attribute
     WHERE attrelid = $1::regclass AND attnum > 0 AND NOT attisdropped
     ORDER BY attnum`,
    [relation],
  );
  return res.rows.map((r) => (r as { attname: string }).attname);
}

describe("table column order round-trip", () => {
  test("wal_rls reloads with columns in declared (non-alphabetical) order", async () => {
    const cluster = await sharedCluster();
    const src = await cluster.createDb("column_order_src");
    const shadow = await cluster.createDb("column_order_shadow");
    try {
      await src.pool.query(TABLE_SQL);
      const fb = (await extract(src.pool)).factBase;

      const files = forLoad(exportSqlFiles(fb, { layout: "by-object" }));
      const loaded = await loadSqlFiles(files, shadow.pool);

      // convergence (order-blind) still holds …
      expect(loaded.factBase.rootHash).toBe(fb.rootHash);
      // … and the reloaded database preserves the declared column order.
      expect(await columnOrder(shadow.pool, "s.wal_rls")).toEqual(
        DECLARED_ORDER,
      );
    } finally {
      await Promise.all([src.drop(), shadow.drop()]);
    }
  }, 120_000);
});
