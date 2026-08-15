/**
 * pruneStaleSqlFiles removes orphaned `.sql` files from a re-exported directory
 * so `schema apply --dir` cannot reload a dropped object's stale file (PR #307
 * review P2). It only DELETES files the previous export OWNED (recorded in the
 * manifest's `files` list); files it never owned are reported as `unmanaged`
 * (and left on disk) unless `pruneUnmanaged` is set. Non-SQL files and files in
 * the keep set are never touched.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pruneStaleSqlFiles } from "./prune-sql-files.ts";

/** `chmod 000` does not stop root, so the unreadable-directory tests are
 *  meaningless there (they would silently pass by reading the directory fine). */
const CAN_MAKE_UNREADABLE = (process.getuid?.() ?? 0) !== 0;

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

  test.skipIf(!CAN_MAKE_UNREADABLE)(
    "an unreadable directory INSIDE _custom/ cannot disable the whole scan",
    () => {
      // The reserved subtree must be skipped DURING traversal, not filtered out
      // after a full walk: a walk that descends into `_custom/` and fails there
      // takes the managed tree's pruning down with it — stale owned files
      // survive, and the rewritten manifest drops their ownership, so they are
      // unmanaged (and un-prunable) forever after.
      const custom = write("_custom/nested/seed.sql", "-- seed\n");
      const stale = write("schemas/app/dropped.sql");
      const unreadable = resolve(root, "_custom", "nested");
      chmodSync(unreadable, 0o000);
      try {
        const { removed, unmanaged } = pruneStaleSqlFiles(
          root,
          new Set(),
          new Set([stale]),
          false,
        );
        expect(removed).toEqual([stale]);
        expect(unmanaged).toEqual([]);
      } finally {
        chmodSync(unreadable, 0o755);
      }
      expect(existsSync(custom)).toBe(true);
    },
  );

  test.skipIf(!CAN_MAKE_UNREADABLE)(
    "propagates a non-ENOENT scan failure instead of reporting an empty tree",
    () => {
      // Swallowing every error makes an unreadable managed directory look like
      // "nothing to prune", so the export writes a manifest that disowns
      // everything it could not see. Only ENOENT (no directory yet) is benign.
      write("schemas/app/dropped.sql");
      const unreadable = resolve(root, "schemas", "app");
      chmodSync(unreadable, 0o000);
      try {
        expect(() =>
          pruneStaleSqlFiles(root, new Set(), undefined, false),
        ).toThrow(/EACCES/);
      } finally {
        chmodSync(unreadable, 0o755);
      }
    },
  );

  test("keep and previouslyOwned entries may be relative to outRoot", () => {
    // Public-API hardening: the manifest and internal callers use absolute
    // paths, but a library consumer passing outRoot-relative entries must get
    // the same semantics — not have every file misread as out-of-set.
    const kept = write("schemas/app/tables/kept.sql");
    const stale = write("schemas/app/tables/dropped.sql");
    const { removed, unmanaged } = pruneStaleSqlFiles(
      root,
      new Set(["schemas/app/tables/kept.sql"]),
      new Set([
        "schemas/app/tables/kept.sql",
        "schemas/app/tables/dropped.sql",
      ]),
      false,
    );
    expect(removed).toEqual([stale]);
    expect(unmanaged).toEqual([]);
    expect(existsSync(kept)).toBe(true);
    expect(existsSync(stale)).toBe(false);
  });

  test("pruneUnmanaged with relative keep entries must not delete kept files", () => {
    // The sharp edge that motivated the normalization: a relative keep set plus
    // pruneUnmanaged=true previously matched nothing and deleted the whole tree.
    const kept = write("kept.sql");
    const { removed, unmanaged } = pruneStaleSqlFiles(
      root,
      new Set(["kept.sql"]),
      undefined,
      true,
    );
    expect(removed).toEqual([]);
    expect(unmanaged).toEqual([]);
    expect(existsSync(kept)).toBe(true);
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
