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
 * The pruner only DELETES files the previous export OWNED (the manifest's
 * `files` list, resolved to absolute paths in `previouslyOwned`). A `.sql` file
 * it never owned — hand-authored SQL an operator dropped into the directory, or
 * everything in a pre-feature / manifest-less dir — is reported as `unmanaged`
 * and left on disk; the caller refuses the export rather than silently deleting
 * it (an unmanaged file is a real hazard because `schema apply --dir` loads the
 * whole tree). `pruneUnmanaged` opts into deleting the unmanaged files too.
 *
 * Only `.sql` files are considered; non-SQL files the operator placed in the
 * directory are never touched.
 *
 * The reserved root-level `_custom/` subtree (custom-dir.ts) is skipped
 * entirely: nothing inside is stale, unmanaged, or deletable — not even with
 * `pruneUnmanaged` — because that folder is the user's durable home for SQL the
 * engine does not model.
 */
import { type Dirent, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { isCustomPath } from "./custom-dir.ts";

/** A missing directory. The only FS failure this module treats as benign: the
 *  root does not exist on a first export, and an entry can vanish mid-walk. */
function isMissing(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "ENOENT";
}

/**
 * Relative POSIX paths of every `*.sql`-named non-directory entry under `dir`,
 * NEVER descending into the reserved root-level `_custom/`.
 *
 * Skipping before the descent (rather than filtering a completed
 * `readdirSync(recursive)` listing) is what makes the reservation robust: the
 * pruner must not even READ that subtree, or an unreadable directory the
 * operator parked in there takes the whole scan down with it — and a scan that
 * silently comes back empty means stale owned files survive AND the manifest
 * rewritten after it disowns them, permanently.
 *
 * `isCustomPath` matches the FIRST segment only, so `rel` being the accumulated
 * path from the root is what keeps a nested `schemas/app/_custom/` ordinary
 * managed space.
 */
function collectSqlCandidates(
  dir: string,
  prefix: string,
  out: string[],
): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return;
    throw error; // EACCES/EIO: a scan that cannot see the tree must not report it empty
  }
  for (const entry of entries) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (isCustomPath(rel)) continue;
    if (entry.isDirectory()) {
      collectSqlCandidates(join(dir, entry.name), rel, out);
    } else if (entry.name.endsWith(".sql")) {
      out.push(rel);
    }
  }
}

/**
 * Scan every `*.sql` file under `outRoot` whose absolute path is not in `keep`.
 * A file present in `previouslyOwned` is a stale owned file and is DELETED
 * (returned under `removed`); any other `.sql` is `unmanaged` and left on disk
 * unless `pruneUnmanaged` is true (then it is deleted too and moved to
 * `removed`, and `unmanaged` comes back empty). `previouslyOwned` is `undefined`
 * when the previous manifest is absent or recorded no `files` list — then every
 * out-of-set `.sql` is unmanaged. A missing `outRoot` (first export) scans
 * nothing; any OTHER scan failure (EACCES, EIO) is raised rather than reported as
 * an empty tree, because a caller that then rewrites the manifest would disown
 * every file the scan could not see. Anything under the reserved root-level
 * `_custom/` is never walked, so it is neither removed nor reported.
 */
export function pruneStaleSqlFiles(
  outRoot: string,
  keep: ReadonlySet<string>,
  previouslyOwned: ReadonlySet<string> | undefined,
  pruneUnmanaged: boolean,
): { removed: string[]; unmanaged: string[] } {
  // The reserved subtree is never even walked, so a manifest that (impossibly —
  // writeExportFiles guards the write) claims a `_custom/` path still cannot turn
  // the pruner into a deleter in there.
  const entries: string[] = [];
  collectSqlCandidates(outRoot, "", entries);
  const removed: string[] = [];
  const unmanaged: string[] = [];
  for (const entry of entries) {
    const full = resolve(outRoot, entry);
    if (keep.has(full)) continue;
    try {
      if (!statSync(full).isFile()) continue;
    } catch (error) {
      if (isMissing(error)) continue; // vanished between readdir and stat, or a dangling symlink
      throw error;
    }
    if (previouslyOwned?.has(full)) {
      rmSync(full);
      removed.push(full);
    } else if (pruneUnmanaged) {
      rmSync(full);
      removed.push(full);
    } else {
      unmanaged.push(full);
    }
  }
  return { removed, unmanaged };
}
