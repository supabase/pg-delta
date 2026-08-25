/**
 * Default load order vs mixed view-before-table.
 *
 * A hand-authored dir with VIEW-then-TABLE in one file stays stuck: late-band
 * escalate does not move CREATE VIEW after CREATE TABLE. An exported dir
 * records loadOrder (table file before view file) so stage 1 converges
 * without reorderOnFailure.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdSchemaApply } from "../src/cli/commands/schema.ts";
import { writeExportManifest } from "../src/frontends/export-manifest.ts";
import { sharedCluster } from "./containers.ts";

function writeHandAuthoredStuck(): string {
  const dir = mkdtempSync(join(tmpdir(), "pgdelta-manifest-adp-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "01_view_first.sql"),
    `CREATE VIEW public.v AS SELECT id FROM public.t;\n\n` +
      `CREATE TABLE public.t (id integer);\n`,
  );
  writeFileSync(
    join(dir, "02_default_privileges.sql"),
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO PUBLIC;\n`,
  );
  return dir;
}

function writeExportedLoadOrder(): string {
  const dir = mkdtempSync(join(tmpdir(), "pgdelta-manifest-adp-exp-"));
  mkdirSync(join(dir, "public", "tables"), { recursive: true });
  mkdirSync(join(dir, "_cluster"), { recursive: true });
  writeFileSync(
    join(dir, "public", "tables", "t.sql"),
    `CREATE TABLE public.t (id integer);\n`,
  );
  writeFileSync(
    join(dir, "_cluster", "zzz_view.sql"),
    `CREATE VIEW public.v AS SELECT id FROM public.t;\n`,
  );
  writeFileSync(
    join(dir, "public", "default_privileges.sql"),
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO PUBLIC;\n`,
  );
  writeExportManifest(dir, {
    redactSecrets: true,
    files: [
      "_cluster/zzz_view.sql",
      "public/default_privileges.sql",
      "public/tables/t.sql",
    ],
    loadOrder: [
      "public/tables/t.sql",
      "_cluster/zzz_view.sql",
      "public/default_privileges.sql",
    ],
  });
  return dir;
}

describe("reorder assist: export loadOrder vs hand-authored mixed file", () => {
  test("an exported dir uses loadOrder and converges with ADP present", async () => {
    const cluster = await sharedCluster();
    const target = await cluster.createDb("manifadp_tgt");
    try {
      await cmdSchemaApply([
        "--dir",
        writeExportedLoadOrder(),
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

  test("a hand-authored dir with view-before-table in one file stays stuck", async () => {
    const cluster = await sharedCluster();
    const target = await cluster.createDb("manifadp_bail_tgt");
    try {
      let err: unknown;
      try {
        await cmdSchemaApply([
          "--dir",
          writeHandAuthoredStuck(),
          "--target",
          target.uri,
          "--renames",
          "off",
        ]);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/stuck|cannot apply/);
    } finally {
      await target.drop();
    }
  }, 120_000);
});
