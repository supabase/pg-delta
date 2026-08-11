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
import { readdirSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { isCustomPath } from "./custom-dir.ts";

/**
 * Scan every `*.sql` file under `outRoot` whose absolute path is not in `keep`.
 * A file present in `previouslyOwned` is a stale owned file and is DELETED
 * (returned under `removed`); any other `.sql` is `unmanaged` and left on disk
 * unless `pruneUnmanaged` is true (then it is deleted too and moved to
 * `removed`, and `unmanaged` comes back empty). `previouslyOwned` is `undefined`
 * when the previous manifest is absent or recorded no `files` list — then every
 * out-of-set `.sql` is unmanaged. A missing `outRoot` (first export) scans
 * nothing. Anything under the reserved root-level `_custom/` is skipped before
 * either classification, so it is neither removed nor reported.
 */
export function pruneStaleSqlFiles(
  outRoot: string,
  keep: ReadonlySet<string>,
  previouslyOwned: ReadonlySet<string> | undefined,
  pruneUnmanaged: boolean,
): { removed: string[]; unmanaged: string[] } {
  let entries: string[];
  try {
    entries = readdirSync(outRoot, { recursive: true }) as string[];
  } catch {
    return { removed: [], unmanaged: [] }; // directory does not exist yet
  }
  const removed: string[] = [];
  const unmanaged: string[] = [];
  for (const entry of entries) {
    // The reserved subtree is skipped BEFORE the owned/unmanaged split, so a
    // manifest that (impossibly — writeExportFiles guards the write) claims a
    // `_custom/` path still cannot turn the pruner into a deleter in there.
    // `readdirSync(recursive)` has already listed the entries, so skipping them
    // here is what "never walk into `_custom/`" means in practice.
    if (isCustomPath(entry)) continue;
    if (!entry.endsWith(".sql")) continue;
    const full = resolve(outRoot, entry);
    if (keep.has(full)) continue;
    try {
      if (!statSync(full).isFile()) continue;
    } catch {
      continue; // vanished between readdir and stat — ignore
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
