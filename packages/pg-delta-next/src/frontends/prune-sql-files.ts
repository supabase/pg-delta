/**
 * Prune orphaned `.sql` files from a declarative export directory.
 *
 * `schema export` writes one file per managed object. When it re-exports into a
 * directory that already holds files from a PREVIOUS export, only the paths in
 * the new file set are overwritten — a file for an object the source no longer
 * has is left behind. `schema apply --dir` loads the directory recursively, so
 * those stale files would reintroduce dropped objects/grants into the desired
 * shadow state (PR #307 review P2). Removing them before writing keeps the
 * exported directory a faithful mirror of the source.
 *
 * Only `.sql` files are considered, and only those NOT in `keep` are removed —
 * non-SQL files the operator placed in the directory are never touched.
 */
import { readdirSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Delete every `*.sql` file under `outRoot` whose absolute path is not in
 * `keep`. Returns the absolute paths removed (for reporting). A missing
 * `outRoot` (first export) prunes nothing.
 */
export function pruneStaleSqlFiles(
  outRoot: string,
  keep: ReadonlySet<string>,
): string[] {
  let entries: string[];
  try {
    entries = readdirSync(outRoot, { recursive: true }) as string[];
  } catch {
    return []; // directory does not exist yet — nothing to prune
  }
  const removed: string[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".sql")) continue;
    const full = resolve(outRoot, entry);
    if (keep.has(full)) continue;
    try {
      if (!statSync(full).isFile()) continue;
    } catch {
      continue; // vanished between readdir and stat — ignore
    }
    rmSync(full);
    removed.push(full);
  }
  return removed;
}
