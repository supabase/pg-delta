/**
 * Manifest-gated ADP-bail exemption for the reorder assist.
 *
 * The assist normally disables itself when a directory contains ALTER DEFAULT
 * PRIVILEGES: ADP applies to objects created AFTER it in authored order, so for
 * a HAND-AUTHORED dir the authored interleaving is semantics the assist must
 * not change (moving the ADP wrongly grants/ungrants objects). But an EXPORTED
 * dir (`.pgdelta-export.json` manifest present) never relies on that — the
 * exporter emits explicit per-object REVOKE/GRANT for every object (enforced
 * invariant, pinned across objtypes by tests/export-fidelity.test.ts) — so ADP
 * position is irrelevant there and the assist can stay on.
 *
 * Fixture: one file whose statements are internally MIS-ORDERED (view before
 * its table). File-granular loading can never apply it (the whole file rolls
 * back every round), while the statement-granular assist reorders and
 * converges. A second file carries an ADP statement:
 *   - WITH the manifest → assist stays on → applies (the exemption);
 *   - WITHOUT the manifest → conservative bail → raw file load → stuck.
 *
 * Docker + @supabase/pg-topo (workspace sibling) required.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdSchemaApply } from "../src/cli/commands/schema.ts";
import { writeExportManifest } from "../src/frontends/export-manifest.ts";
import { sharedCluster } from "./containers.ts";

function writeFixture(withManifest: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), "pgdelta-manifest-adp-"));
  mkdirSync(dir, { recursive: true });
  // internally mis-ordered: the view precedes the table it selects from, so
  // an atomic whole-file apply fails every retry round; only the
  // statement-granular reorder assist can converge this.
  writeFileSync(
    join(dir, "01_view_first.sql"),
    `CREATE VIEW public.v AS SELECT id FROM public.t;\n\n` +
      `CREATE TABLE public.t (id integer);\n`,
  );
  writeFileSync(
    join(dir, "02_default_privileges.sql"),
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO PUBLIC;\n`,
  );
  if (withManifest) writeExportManifest(dir, { redactSecrets: true });
  return dir;
}

describe("reorder assist: manifest-gated ADP exemption", () => {
  test("an exported dir (manifest) with ADP keeps the assist and converges", async () => {
    const cluster = await sharedCluster();
    const target = await cluster.createDb("manifadp_tgt");
    try {
      await cmdSchemaApply([
        "--dir",
        writeFixture(true),
        "--target",
        target.uri,
        "--renames",
        "off",
      ]);
      const { rows } = await target.pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_views
          WHERE schemaname = 'public' AND viewname = 'v'`,
      );
      expect(rows[0]?.n).toBe(1);
    } finally {
      await target.drop();
    }
  }, 120_000);

  test("a hand-authored dir (no manifest) with ADP keeps the conservative bail", async () => {
    const cluster = await sharedCluster();
    const target = await cluster.createDb("manifadp_bail_tgt");
    try {
      let err: unknown;
      try {
        await cmdSchemaApply([
          "--dir",
          writeFixture(false),
          "--target",
          target.uri,
          "--renames",
          "off",
        ]);
      } catch (e) {
        err = e;
      }
      // bail → raw file-granular load → the mis-ordered file can never apply
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/stuck|cannot apply/);
    } finally {
      await target.drop();
    }
  }, 120_000);
});
