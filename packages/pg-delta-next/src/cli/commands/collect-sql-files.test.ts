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
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readExportManifest } from "../../frontends/export-manifest.ts";
import { collectSqlFiles, writeExportFiles } from "./schema.ts";

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
});

describe("writeExportFiles", () => {
  test("creates a brand-new root and writes the manifest even with zero files", () => {
    // a DB with no managed objects yields zero files; the per-file loop would
    // never create outRoot, so the manifest write must create it first (review P2).
    const target = join(root, "nested", "brand-new");
    const removed = writeExportFiles(target, [], {
      redactSecrets: true,
      profile: "raw",
    });
    expect(removed).toEqual([]);
    expect(existsSync(join(target, ".pgdelta-export.json"))).toBe(true);
    expect(readExportManifest(target)).toEqual({
      redactSecrets: true,
      profile: "raw",
    });
  });

  test("writes files and the manifest, pruning stale ones", () => {
    const target = join(root, "out2");
    mkdirSync(join(target, "schemas", "app"), { recursive: true });
    writeFileSync(join(target, "schemas", "app", "gone.sql"), "-- stale\n");
    const removed = writeExportFiles(
      target,
      [
        {
          name: join("schemas", "app", "t.sql"),
          sql: "CREATE TABLE app.t ();\n",
        },
      ],
      { redactSecrets: false },
    );
    expect(removed).toEqual([join(target, "schemas", "app", "gone.sql")]);
    expect(existsSync(join(target, "schemas", "app", "t.sql"))).toBe(true);
    expect(existsSync(join(target, "schemas", "app", "gone.sql"))).toBe(false);
    expect(readExportManifest(target)?.redactSecrets).toBe(false);
  });
});
