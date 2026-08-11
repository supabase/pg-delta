/**
 * pruneStaleSqlFiles removes orphaned `.sql` files from a re-exported directory
 * so `schema apply --dir` cannot reload a dropped object's stale file (PR #307
 * review P2). It only DELETES files the previous export OWNED (recorded in the
 * manifest's `files` list); files it never owned are reported as `unmanaged`
 * (and left on disk) unless `pruneUnmanaged` is set. Non-SQL files and files in
 * the keep set are never touched.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pruneStaleSqlFiles } from "./prune-sql-files.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pgdn-prune-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(rel: string, body = "-- sql\n"): string {
  const full = resolve(root, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, body, "utf8");
  return full;
}

describe("pruneStaleSqlFiles", () => {
  test("removes previously-owned .sql files not in the keep set, recursively", () => {
    const keepFile = write("schemas/app/tables/kept.sql");
    const staleFile = write("schemas/app/tables/dropped.sql");
    const staleNested = write("cluster/roles.sql");
    const previouslyOwned = new Set([keepFile, staleFile, staleNested]);

    const { removed, unmanaged } = pruneStaleSqlFiles(
      root,
      new Set([keepFile]),
      previouslyOwned,
      false,
    );

    expect(removed.sort()).toEqual([staleNested, staleFile].sort());
    expect(unmanaged).toEqual([]);
    expect(existsSync(keepFile)).toBe(true);
    expect(existsSync(staleFile)).toBe(false);
    expect(existsSync(staleNested)).toBe(false);
  });

  test("flags unmanaged files (never owned) without deleting them", () => {
    const handwritten = write("schemas/app/handwritten.sql");
    // previouslyOwned undefined => pre-feature / hand-authored dir.
    const { removed, unmanaged } = pruneStaleSqlFiles(
      root,
      new Set(),
      undefined,
      false,
    );
    expect(removed).toEqual([]);
    expect(unmanaged).toEqual([handwritten]);
    expect(existsSync(handwritten)).toBe(true);
  });

  test("only files present in previouslyOwned are deleted; others are unmanaged", () => {
    const owned = write("owned.sql");
    const foreign = write("foreign.sql");
    const { removed, unmanaged } = pruneStaleSqlFiles(
      root,
      new Set(),
      new Set([owned]),
      false,
    );
    expect(removed).toEqual([owned]);
    expect(unmanaged).toEqual([foreign]);
    expect(existsSync(owned)).toBe(false);
    expect(existsSync(foreign)).toBe(true);
  });

  test("pruneUnmanaged deletes unmanaged files too and returns them under removed", () => {
    const handwritten = write("schemas/app/handwritten.sql");
    const { removed, unmanaged } = pruneStaleSqlFiles(
      root,
      new Set(),
      undefined,
      true,
    );
    expect(removed).toEqual([handwritten]);
    expect(unmanaged).toEqual([]);
    expect(existsSync(handwritten)).toBe(false);
  });

  test("never touches non-.sql files", () => {
    const readme = write("README.md", "# notes\n");
    const stale = write("schemas/app/x.sql");
    pruneStaleSqlFiles(root, new Set(), new Set([stale]), false);
    expect(existsSync(readme)).toBe(true);
    expect(existsSync(stale)).toBe(false);
  });

  test("returns empty for a directory that does not exist yet (first export)", () => {
    expect(
      pruneStaleSqlFiles(resolve(root, "missing"), new Set(), undefined, false),
    ).toEqual({ removed: [], unmanaged: [] });
  });

  test("never scans the reserved _custom/ subtree: not unmanaged, not deleted", () => {
    // docs/architecture/custom-folder.md §2: `_custom/` is the user's durable
    // home for SQL pg-delta does not model. Reporting it as unmanaged would make
    // every re-export refuse; deleting it would destroy hand-authored SQL.
    const custom = write("_custom/text-search.sql", "-- custom\n");
    const nested = write("_custom/nested/seed.sql", "-- seed\n");
    const stale = write("schemas/app/dropped.sql");
    const { removed, unmanaged } = pruneStaleSqlFiles(
      root,
      new Set(),
      new Set([stale]),
      false,
    );
    expect(removed).toEqual([stale]);
    expect(unmanaged).toEqual([]);
    expect(existsSync(custom)).toBe(true);
    expect(existsSync(nested)).toBe(true);
  });

  test("--prune-unmanaged still never deletes inside _custom/", () => {
    const custom = write("_custom/text-search.sql", "-- custom\n");
    const handwritten = write("schemas/app/handwritten.sql");
    const { removed, unmanaged } = pruneStaleSqlFiles(
      root,
      new Set(),
      undefined,
      true,
    );
    expect(removed).toEqual([handwritten]);
    expect(unmanaged).toEqual([]);
    expect(existsSync(custom)).toBe(true);
  });

  test("a previously-owned entry under _custom/ is defensively never deleted", () => {
    // The exporter can never own a `_custom/` path (writeExportFiles guards it),
    // so a manifest claiming one is corrupt/hand-edited input — it must not turn
    // the pruner into a deleter inside the reserved subtree.
    const custom = write("_custom/text-search.sql", "-- custom\n");
    const { removed, unmanaged } = pruneStaleSqlFiles(
      root,
      new Set(),
      new Set([custom]),
      false,
    );
    expect(removed).toEqual([]);
    expect(unmanaged).toEqual([]);
    expect(existsSync(custom)).toBe(true);
  });

  test("a NESTED _custom/ directory is ordinary managed space", () => {
    // only the ROOT-level `_custom` is reserved (one auditable location).
    const nestedCustom = write("schemas/app/_custom/x.sql");
    const { removed, unmanaged } = pruneStaleSqlFiles(
      root,
      new Set(),
      undefined,
      false,
    );
    expect(removed).toEqual([]);
    expect(unmanaged).toEqual([nestedCustom]);
  });
});
