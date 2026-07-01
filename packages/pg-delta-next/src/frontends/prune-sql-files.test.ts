/**
 * pruneStaleSqlFiles removes orphaned `.sql` files from a re-exported directory
 * so `schema apply --dir` cannot reload a dropped object's stale file (PR #307
 * review P2). Non-SQL files and files in the keep set are never touched.
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
  test("removes stale .sql files not in the keep set, recursively", () => {
    const keepFile = write("schemas/app/tables/kept.sql");
    const staleFile = write("schemas/app/tables/dropped.sql");
    const staleNested = write("cluster/roles.sql");

    const removed = pruneStaleSqlFiles(root, new Set([keepFile]));

    expect(removed.sort()).toEqual([staleNested, staleFile].sort());
    expect(existsSync(keepFile)).toBe(true);
    expect(existsSync(staleFile)).toBe(false);
    expect(existsSync(staleNested)).toBe(false);
  });

  test("never touches non-.sql files", () => {
    const readme = write("README.md", "# notes\n");
    const stale = write("schemas/app/x.sql");
    pruneStaleSqlFiles(root, new Set());
    expect(existsSync(readme)).toBe(true);
    expect(existsSync(stale)).toBe(false);
  });

  test("returns [] for a directory that does not exist yet (first export)", () => {
    expect(pruneStaleSqlFiles(resolve(root, "missing"), new Set())).toEqual([]);
  });
});
