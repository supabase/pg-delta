/**
 * collectSqlFiles must derive relative names from the NORMALIZED root, so a
 * trailing slash (or other non-normalized --dir) does not drop the first
 * character of every name and corrupt the raw loader's lexicographic order
 * (PR #307 review P2). No DB.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { readExportManifest } from "../../frontends/export-manifest.ts";
import {
  collectSqlFiles,
  prepareApplyFiles,
  writeExportFiles,
} from "./schema.ts";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pgdn-collect-"));
  mkdirSync(join(root, "schemas", "app"), { recursive: true });
  writeFileSync(join(root, "01_schema.sql"), "CREATE SCHEMA app;\n");
  writeFileSync(join(root, "10_table.sql"), "CREATE TABLE app.t (id int);\n");
  writeFileSync(join(root, "schemas", "app", "x.sql"), "SELECT 1;\n");
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("collectSqlFiles", () => {
  for (const suffix of ["", "/"]) {
    test(`derives correct names with dir suffix ${JSON.stringify(suffix)}`, () => {
      const names = collectSqlFiles(root + suffix)
        .map((f) => f.name)
        .sort();
      // RED before the fix (trailing slash): names lost their first char, e.g.
      // "1_schema.sql", reordering 01_ vs 10_ against 0_table.sql.
      expect(names).toEqual([
        "01_schema.sql",
        "10_table.sql",
        join("schemas", "app", "x.sql"),
      ]);
    });
  }

  test("collects _custom/**/*.sql so the shadow can elaborate on it", () => {
    // The whole point of the reserved folder (docs/architecture/custom-folder.md
    // §2): `schema apply` needs no change because the recursive glob already
    // loads it into the shadow. Pinned so a future export-side exclusion is not
    // accidentally mirrored into the loader.
    mkdirSync(join(root, "_custom", "nested"), { recursive: true });
    writeFileSync(
      join(root, "_custom", "text-search.sql"),
      "-- pgdelta-migration: none\nSELECT 1;\n",
    );
    writeFileSync(join(root, "_custom", "nested", "seed.sql"), "SELECT 2;\n");
    writeFileSync(join(root, "_custom", "README.md"), "# not sql\n");
    const names = collectSqlFiles(root).map((f) => f.name);
    expect(names).toContain(join("_custom", "text-search.sql"));
    expect(names).toContain(join("_custom", "nested", "seed.sql"));
    expect(names).not.toContain(join("_custom", "README.md"));
  });
});

describe("writeExportFiles", () => {
  test("creates a brand-new root and writes the manifest (with an empty files list) even with zero files", () => {
    // a DB with no managed objects yields zero files; the per-file loop would
    // never create outRoot, so the manifest write must create it first (review P2).
    const target = join(root, "nested", "brand-new");
    const { removed, unmanaged } = writeExportFiles(
      target,
      [],
      {
        redactSecrets: true,
        profile: "raw",
      },
      false,
    );
    expect(removed).toEqual([]);
    expect(unmanaged).toEqual([]);
    expect(existsSync(join(target, ".pgdelta-export.json"))).toBe(true);
    expect(readExportManifest(target)).toEqual({
      redactSecrets: true,
      profile: "raw",
      files: [],
    });
  });

  test("records the owned files list as sorted POSIX relative paths", () => {
    const target = join(root, "sorted");
    const { removed } = writeExportFiles(
      target,
      [
        { name: join("schemas", "app", "b.sql"), sql: "-- b\n" },
        { name: join("schemas", "app", "a.sql"), sql: "-- a\n" },
        { name: join("cluster", "roles.sql"), sql: "-- roles\n" },
      ],
      { redactSecrets: false },
      false,
    );
    expect(removed).toEqual([]);
    expect(readExportManifest(target)?.files).toEqual([
      "cluster/roles.sql",
      "schemas/app/a.sql",
      "schemas/app/b.sql",
    ]);
  });

  test("prunes a previously-owned file that dropped out of the new set", () => {
    const target = join(root, "reexport");
    // first export owns t.sql AND gone.sql
    writeExportFiles(
      target,
      [
        {
          name: join("schemas", "app", "t.sql"),
          sql: "CREATE TABLE app.t ();\n",
        },
        { name: join("schemas", "app", "gone.sql"), sql: "-- gone\n" },
      ],
      { redactSecrets: false },
      false,
    );
    // re-export drops gone.sql: it was owned, so it is pruned with no error
    const { removed, unmanaged } = writeExportFiles(
      target,
      [
        {
          name: join("schemas", "app", "t.sql"),
          sql: "CREATE TABLE app.t ();\n",
        },
      ],
      { redactSecrets: false },
      false,
    );
    expect(removed).toEqual([join(target, "schemas", "app", "gone.sql")]);
    expect(unmanaged).toEqual([]);
    expect(existsSync(join(target, "schemas", "app", "t.sql"))).toBe(true);
    expect(existsSync(join(target, "schemas", "app", "gone.sql"))).toBe(false);
  });

  test("throws (and preserves the file) on an unmanaged .sql not previously owned", () => {
    const target = join(root, "handauthored");
    mkdirSync(join(target, "schemas", "app"), { recursive: true });
    writeFileSync(
      join(target, "schemas", "app", "handwritten.sql"),
      "-- hand-authored\n",
    );
    expect(() =>
      writeExportFiles(
        target,
        [
          {
            name: join("schemas", "app", "t.sql"),
            sql: "CREATE TABLE app.t ();\n",
          },
        ],
        { redactSecrets: false },
        false,
      ),
    ).toThrow(/handwritten\.sql[\s\S]*--prune-unmanaged/);
    // the unmanaged file survives, and no new file / manifest was written
    expect(existsSync(join(target, "schemas", "app", "handwritten.sql"))).toBe(
      true,
    );
    expect(existsSync(join(target, "schemas", "app", "t.sql"))).toBe(false);
    expect(existsSync(join(target, ".pgdelta-export.json"))).toBe(false);
  });

  test("a RELATIVE out-dir re-exports without spurious removals", () => {
    // The manifest's owned paths resolve to ABSOLUTE paths while the keep set
    // was joined onto the raw outRoot: with a relative --out-dir the pruner
    // misread its own current files as out-of-set and deleted-then-rewrote
    // them on every re-export (removed misreported; PR #368 review).
    // writeExportFiles must normalize outRoot once up front.
    const target = join(root, "relative-root");
    const relTarget = relative(process.cwd(), target);
    const file = {
      name: join("schemas", "app", "t.sql"),
      sql: "CREATE TABLE app.t ();\n",
    };
    writeExportFiles(relTarget, [file], { redactSecrets: false }, false);
    const { removed, unmanaged } = writeExportFiles(
      relTarget,
      [file],
      { redactSecrets: false },
      false,
    );
    expect(removed).toEqual([]);
    expect(unmanaged).toEqual([]);
    expect(existsSync(join(target, "schemas", "app", "t.sql"))).toBe(true);
  });

  test("--prune-unmanaged deletes the unmanaged file and proceeds", () => {
    const target = join(root, "handauthored2");
    mkdirSync(join(target, "schemas", "app"), { recursive: true });
    writeFileSync(
      join(target, "schemas", "app", "handwritten.sql"),
      "-- hand-authored\n",
    );
    const { removed, unmanaged } = writeExportFiles(
      target,
      [
        {
          name: join("schemas", "app", "t.sql"),
          sql: "CREATE TABLE app.t ();\n",
        },
      ],
      { redactSecrets: false },
      true,
    );
    expect(removed).toEqual([
      join(target, "schemas", "app", "handwritten.sql"),
    ]);
    expect(unmanaged).toEqual([]);
    expect(existsSync(join(target, "schemas", "app", "handwritten.sql"))).toBe(
      false,
    );
    expect(existsSync(join(target, "schemas", "app", "t.sql"))).toBe(true);
    expect(existsSync(join(target, ".pgdelta-export.json"))).toBe(true);
  });

  test("a .sql file under _custom/ is neither unmanaged nor owned (no refusal, no manifest entry)", () => {
    // docs/architecture/custom-folder.md §2: the reserved folder survives every
    // re-export. Before this, the unmanaged scan saw it and refused the export.
    const target = join(root, "customdir");
    mkdirSync(join(target, "_custom"), { recursive: true });
    const customFile = join(target, "_custom", "text-search.sql");
    const customBody =
      "-- pgdelta-migration: none\nCREATE TEXT SEARCH CONFIGURATION public.cfg (COPY = pg_catalog.english);\n";
    writeFileSync(customFile, customBody, "utf8");
    const { removed, unmanaged } = writeExportFiles(
      target,
      [{ name: join("schemas", "app", "t.sql"), sql: "CREATE TABLE app.t ();\n" }],
      { redactSecrets: false },
      false,
    );
    expect(unmanaged).toEqual([]);
    expect(removed).toEqual([]);
    expect(readFileSync(customFile, "utf8")).toBe(customBody);
    expect(readExportManifest(target)?.files).toEqual([
      "schemas/app/t.sql",
    ]);
  });

  test("--prune-unmanaged does not delete inside _custom/", () => {
    const target = join(root, "customdir-prune");
    mkdirSync(join(target, "_custom"), { recursive: true });
    const customFile = join(target, "_custom", "seed.sql");
    writeFileSync(customFile, "-- pgdelta-migration: none\n", "utf8");
    const { removed, unmanaged } = writeExportFiles(
      target,
      [{ name: join("schemas", "app", "t.sql"), sql: "CREATE TABLE app.t ();\n" }],
      { redactSecrets: false },
      true,
    );
    expect(removed).toEqual([]);
    expect(unmanaged).toEqual([]);
    expect(existsSync(customFile)).toBe(true);
  });

  test("refuses to write an exported file into the reserved _custom/ folder", () => {
    // Unreachable through the renderers (no layout emits `_custom/…`), but the
    // reservation must be enforced where files are written, not merely assumed.
    const target = join(root, "customdir-collision");
    expect(() =>
      writeExportFiles(
        target,
        [{ name: join("_custom", "t.sql"), sql: "CREATE TABLE app.t ();\n" }],
        { redactSecrets: false },
        false,
      ),
    ).toThrow(/_custom/);
    expect(existsSync(join(target, "_custom", "t.sql"))).toBe(false);
  });

  test("scaffolds _custom/README.md on export and never overwrites it", () => {
    const target = join(root, "customdir-readme");
    const first = writeExportFiles(
      target,
      [{ name: join("schemas", "app", "t.sql"), sql: "CREATE TABLE app.t ();\n" }],
      { redactSecrets: false },
      false,
    );
    const readme = join(target, "_custom", "README.md");
    expect(first.scaffoldedCustomReadme).toBe(true);
    expect(readFileSync(readme, "utf8")).toContain("pgdelta-migration");
    // README.md is not `.sql`, so it is invisible to the loader and the pruner —
    // and it is never recorded as an owned file.
    expect(readExportManifest(target)?.files).toEqual(["schemas/app/t.sql"]);

    writeFileSync(readme, "# my notes\n", "utf8");
    const second = writeExportFiles(
      target,
      [{ name: join("schemas", "app", "t.sql"), sql: "CREATE TABLE app.t ();\n" }],
      { redactSecrets: false },
      false,
    );
    expect(second.scaffoldedCustomReadme).toBe(false);
    expect(readFileSync(readme, "utf8")).toBe("# my notes\n");
  });
});

describe("prepareApplyFiles", () => {
  function dirWith(files: Record<string, string>): string {
    const d = mkdtempSync(join(tmpdir(), "pgdn-prepare-"));
    for (const [name, sql] of Object.entries(files)) {
      const p = join(d, name);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, sql);
    }
    return d;
  }

  test("refuses an all-cluster-DDL dir after --skip-cluster-ddl (would drop everything)", () => {
    // The up-front executable-SQL guard passes on the ORIGINAL role DDL, but
    // --skip-cluster-ddl strips it to nothing → empty shadow → destructive
    // drop-all of every managed object. It must be refused after stripping.
    const d = dirWith({
      "roles.sql": "CREATE ROLE app;\nALTER ROLE app WITH LOGIN;\n",
    });
    try {
      const r = prepareApplyFiles(d, "database", true);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.message).toContain("no executable database-scope SQL remains");
      }
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test("keeps the non-cluster SQL when --skip-cluster-ddl leaves real statements", () => {
    const d = dirWith({
      "1.sql": "CREATE ROLE app;\nCREATE TABLE public.t (id int);\n",
    });
    try {
      const r = prepareApplyFiles(d, "database", true);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.skipped.length).toBeGreaterThan(0);
        expect(r.files.map((f) => f.sql).join("")).toContain("CREATE TABLE");
      }
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test("refuses cluster DDL in database scope without --skip-cluster-ddl", () => {
    const d = dirWith({
      "roles.sql": "CREATE ROLE app;\n",
      "t.sql": "CREATE TABLE public.t (id int);\n",
    });
    try {
      const r = prepareApplyFiles(d, "database", false);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toContain("cluster DDL");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test("refuses an empty / comment-only dir", () => {
    const d = dirWith({ "c.sql": "-- just a comment\n" });
    try {
      const r = prepareApplyFiles(d, "database", false);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toContain("no executable SQL found");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test("accepts a normal database-scope dir", () => {
    const d = dirWith({ "t.sql": "CREATE TABLE public.t (id int);\n" });
    try {
      expect(prepareApplyFiles(d, "database", false).ok).toBe(true);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});
