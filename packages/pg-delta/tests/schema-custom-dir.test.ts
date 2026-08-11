/**
 * The reserved `_custom/` folder, end-to-end (docs/architecture/custom-folder.md).
 *
 * The motivating trap: a MODELED object depending on an UNMODELED one. A GIN
 * index over `to_tsvector('public.my_cfg'::regconfig, …)` is modeled; the text
 * search configuration it needs is not (`unmodeled_kind`), so it never reaches
 * the export — and the shadow can no longer elaborate the index. `_custom/` is
 * the durable home for that prerequisite:
 *
 *   1. the `unmodeled_kind` diagnostic names the escape hatch;
 *   2. without the custom file, `schema apply` cannot build the shadow at all
 *      (anti-vacuity — the custom file is what fixes it);
 *   3. a re-export neither refuses on, prunes, nor records the custom file, and
 *      scaffolds `_custom/README.md`;
 *   4. the shadow then elaborates the index, and the unmodeled prerequisite
 *      never enters the plan (it produces no facts) — the operator delivers it
 *      to the target through their own migration channel.
 *
 * Docker required.
 */
import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdSchemaApply, cmdSchemaExport } from "../src/cli/commands/schema.ts";
import { extract } from "../src/extract/extract.ts";
import { readExportManifest } from "../src/frontends/export-manifest.ts";
import { ShadowLoadError } from "../src/frontends/load-sql-files.ts";
import { sharedCluster } from "./containers.ts";

const TS_CONFIG_DDL =
  "CREATE TEXT SEARCH CONFIGURATION public.my_cfg (COPY = pg_catalog.english);\n";

const SOURCE_SQL = `
  ${TS_CONFIG_DDL}
  CREATE TABLE public.docs (id integer PRIMARY KEY, body text NOT NULL);
  CREATE INDEX docs_body_idx ON public.docs
    USING gin (to_tsvector('public.my_cfg'::regconfig, body));
`;

/** Every file body under `dir`, recursively (directory entries skipped). */
function readAll(dir: string): { name: string; body: string }[] {
  return (readdirSync(dir, { recursive: true }) as string[]).flatMap((name) => {
    try {
      return [{ name, body: readFileSync(join(dir, name), "utf8") }];
    } catch {
      return []; // directory entry
    }
  });
}

describe("reserved _custom/ folder", () => {
  test("preserves hand-authored unmodeled SQL across re-export and lets the shadow elaborate its dependents", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("custom_src");
    const target = await cluster.createDb("custom_tgt");
    const work = mkdtempSync(join(tmpdir(), "pgdelta-customdir-"));
    const outDir = join(work, "schema");
    try {
      await source.pool.query(SOURCE_SQL);

      // 1. the unmodeled-kind diagnostic points at the escape hatch
      const { diagnostics } = await extract(source.pool);
      const unmodeled = diagnostics.find(
        (d) =>
          d.code === "unmodeled_kind" &&
          d.context?.["kind"] === "text search configuration",
      );
      expect(unmodeled).toBeDefined();
      expect(unmodeled?.message).toContain("my_cfg");
      expect(unmodeled?.message).toContain("_custom/");

      // 2. export: the modeled index is written, the unmodeled config is not
      await cmdSchemaExport(["--source", source.uri, "--out-dir", outDir]);
      const exported = readAll(outDir);
      expect(exported.some((f) => f.body.includes("docs_body_idx"))).toBe(true);
      expect(exported.some((f) => /create text search/i.test(f.body))).toBe(
        false,
      );
      // the folder is scaffolded on export, documenting its own contract
      const readmePath = join(outDir, "_custom", "README.md");
      expect(existsSync(readmePath)).toBe(true);
      expect(readFileSync(readmePath, "utf8")).toContain("pgdelta-migration");

      // 3. anti-vacuity: with the prerequisite missing, the shadow cannot even
      // be built — this is the failure `_custom/` exists to fix.
      let shadowError: unknown;
      try {
        await cmdSchemaApply([
          "--dir",
          outDir,
          "--target",
          target.uri,
          "--renames",
          "off",
          "--dry-run",
        ]);
      } catch (e) {
        shadowError = e;
      }
      expect(shadowError).toBeInstanceOf(ShadowLoadError);
      // the PostgreSQL text lives in the per-statement details, not the summary
      expect(
        (shadowError as ShadowLoadError).details
          .map((d) => d.message)
          .join("\n"),
      ).toMatch(/my_cfg/);

      // 4. park the prerequisite in the reserved folder, with its migration twin
      // declared as deliberately absent
      const customFile = join(outDir, "_custom", "text-search.sql");
      const customBody = `-- pgdelta-migration: none\n${TS_CONFIG_DDL}`;
      mkdirSync(join(outDir, "_custom"), { recursive: true });
      writeFileSync(customFile, customBody, "utf8");

      // 5. re-export: no refusal, byte-identical custom file, no manifest entry
      await cmdSchemaExport(["--source", source.uri, "--out-dir", outDir]);
      expect(readFileSync(customFile, "utf8")).toBe(customBody);
      expect(existsSync(readmePath)).toBe(true);
      const manifestFiles = readExportManifest(outDir)?.files ?? [];
      expect(manifestFiles.length).toBeGreaterThan(0);
      expect(manifestFiles.filter((f) => f.startsWith("_custom/"))).toEqual([]);

      // 6. the shadow now elaborates the index; the unmodeled prerequisite
      // produces no facts, so it never enters the plan
      const planPath = join(work, "plan.json");
      await cmdSchemaApply([
        "--dir",
        outDir,
        "--target",
        target.uri,
        "--renames",
        "off",
        "--dry-run",
        "--out-plan",
        planPath,
      ]);
      const plan = readFileSync(planPath, "utf8");
      expect(plan).toContain("docs_body_idx");
      expect(plan).not.toMatch(/text search/i);

      // 7. the operator delivers the unmodeled DDL to the target themselves
      // (`_custom/` feeds the shadow only) — then the apply converges.
      await target.pool.query(TS_CONFIG_DDL);
      await cmdSchemaApply([
        "--dir",
        outDir,
        "--target",
        target.uri,
        "--renames",
        "off",
      ]);
      const { rows } = await target.pool.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'docs'`,
      );
      expect(rows.map((r) => r.indexname)).toContain("docs_body_idx");
    } finally {
      await Promise.all([source.drop(), target.drop()]);
    }
  }, 300_000);
});
