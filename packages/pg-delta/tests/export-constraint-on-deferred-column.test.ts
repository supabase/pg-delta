/**
 * Export constraint-fold guard: a table UNIQUE/PK/CHECK constraint must NOT be
 * folded inline into `CREATE TABLE` when its own same-table column was deferred
 * out of the CREATE into a later `ALTER TABLE … ADD COLUMN` statement.
 *
 * Two deferral causes are exercised at once:
 *  - `slug s.slug_text` — a domain-typed column. Its ADD COLUMN depends on the
 *    domain CREATE, an edge that crosses the table CREATE, so the column fold is
 *    rejected and the column is deferred.
 *  - `slug_key … GENERATED ALWAYS AS (lower(slug))` — a generated column, which
 *    never gets a fold hint (see src/plan/rules/tables.ts).
 *
 * Before the fix `compactColumnFolds` folded the two UNIQUE constraints inline
 * (`!isConstraintFold` bypassed the crossing guard), so the exported CREATE TABLE
 * referenced `slug` / `slug_key` that were not yet columns, and the reload failed
 * with `column "slug" named in key does not exist`.
 *
 * After the fix the constraints render as standalone `ALTER TABLE … ADD
 * CONSTRAINT … UNIQUE (…)`, the export reloads, and the shadow re-extract
 * hash-matches the source.
 *
 * Stock alpine image; Docker required.
 */
import { describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import { exportSqlFiles } from "../src/frontends/export-sql-files.ts";
import { loadSqlFiles } from "../src/frontends/load-sql-files.ts";
import { createTestDb } from "./containers.ts";

const SCHEMA_SQL = `
  CREATE SCHEMA s;
  CREATE DOMAIN s.slug_text AS text CHECK (length(VALUE) > 0);
  CREATE TABLE s.organizations (
    id uuid PRIMARY KEY,
    slug s.slug_text NOT NULL,
    slug_key text GENERATED ALWAYS AS (lower(slug::text)) STORED,
    CONSTRAINT organizations_slug_key UNIQUE (slug),
    CONSTRAINT organizations_slug_key_key UNIQUE (slug_key)
  );
`;

function forLoad(files: { name: string; sql: string }[]) {
  // roles are cluster-global and already present in the shared cluster.
  return files.filter((f) => !/cluster[_/]roles/.test(f.name));
}

describe("export: key constraint on a deferred column", () => {
  test("UNIQUE constraints on domain/generated columns reload", async () => {
    const src = await createTestDb("keycon_src");
    const shadow = await createTestDb("keycon_shadow");
    try {
      await src.pool.query(SCHEMA_SQL);
      const fb = (await extract(src.pool)).factBase;

      const files = forLoad(exportSqlFiles(fb, { layout: "by-object" }));

      // the exported organizations table must render its UNIQUE constraints as
      // standalone ALTER TABLE … ADD CONSTRAINT — not inline in the CREATE.
      const tableSql = files
        .filter((f) => /organizations/.test(f.sql))
        .map((f) => f.sql)
        .join("\n");
      expect(tableSql).toMatchInlineSnapshot(`
        "CREATE TABLE "s"."organizations" ("id" uuid NOT NULL, CONSTRAINT "organizations_pkey" PRIMARY KEY (id));

        ALTER TABLE "s"."organizations" OWNER TO "test";

        ALTER TABLE "s"."organizations" ADD COLUMN "slug" s.slug_text NOT NULL;

        ALTER TABLE "s"."organizations" ADD COLUMN "slug_key" text GENERATED ALWAYS AS (lower((slug)::text)) STORED;

        ALTER TABLE "s"."organizations" ADD CONSTRAINT "organizations_slug_key_key" UNIQUE (slug_key);

        ALTER TABLE "s"."organizations" ADD CONSTRAINT "organizations_slug_key" UNIQUE (slug);
        "
      `);

      const loaded = await loadSqlFiles(files, shadow.pool);
      expect(loaded.factBase.rootHash).toBe(fb.rootHash);
    } finally {
      await Promise.all([src.drop(), shadow.drop()]);
    }
  }, 120_000);
});
