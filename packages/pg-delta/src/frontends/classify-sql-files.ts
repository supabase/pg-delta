/**
 * Pure export-file classification for declarative schema trees.
 *
 * Compares a proposed `SqlFile[]` (what an export would write) against an
 * in-memory existing tree and the previous export's owned-file list
 * (`.pgdelta-export.json` `files`). Returns created / updated / unchanged /
 * removed / unmanaged as POSIX-relative paths. No filesystem mutation: the
 * caller owns staging, `--force` / `--prune-unmanaged` authorization, and
 * install (schema-first CLI enablement WP3a; the RFC's "reusable typed file
 * classification helper").
 *
 * `_custom/` is invisible here, matching the exporter reservation
 * (`custom-dir.ts`): nothing under the root-level folder is created, updated,
 * unchanged, removed, or unmanaged. Nested `schemas/app/_custom/` is ordinary
 * managed space.
 */
import type { SqlFile } from "./load-sql-files.ts";
import { isCustomPath } from "./custom-dir.ts";

export type SqlFileChange = "created" | "updated" | "unchanged";

export interface ClassifySqlFilesInput {
  /** Files the export would write. Names may use either separator; results
   *  are POSIX-relative. */
  proposed: readonly SqlFile[];
  /** Existing `.sql` file bodies keyed by path relative to the export root.
   *  Either separator is accepted. Non-`.sql` keys and `_custom/**` are ignored. */
  existing: ReadonlyMap<string, string>;
  /** POSIX-relative paths the previous export owned (`ExportManifest.files`).
   *  Absent (pre-feature / hand-authored dir) → every extra `.sql` is
   *  unmanaged; none are removed. */
  previouslyOwned?: ReadonlySet<string>;
}

export interface SqlFileClassification {
  created: string[];
  updated: string[];
  unchanged: string[];
  /** Previously owned `.sql` present in `existing` but not in `proposed`. */
  removed: string[];
  /** `.sql` present in `existing` that the previous export did not own and
   *  `proposed` does not claim. */
  unmanaged: string[];
}

/** Normalize a relative path to POSIX (`/` separators, no empty segments). */
function posixRelPath(relPath: string): string {
  return relPath
    .split(/[\\/]/)
    .filter((segment) => segment !== "")
    .join("/");
}

function isManagedSqlPath(path: string): boolean {
  return path.endsWith(".sql") && !isCustomPath(path);
}

/** Classify one proposed body against the bytes already at that path. */
export function classifySqlContent(
  existing: string | undefined,
  proposed: string,
): SqlFileChange {
  if (existing === undefined) return "created";
  return existing === proposed ? "unchanged" : "updated";
}

/**
 * Classify a proposed export against an existing tree without writing or
 * deleting anything. Paths in the result are POSIX-relative.
 *
 * `created` / `updated` / `unchanged` follow `proposed` order (first
 * occurrence). `removed` / `unmanaged` are sorted.
 */
export function classifySqlFiles(
  input: ClassifySqlFilesInput,
): SqlFileClassification {
  const proposedByPath = new Map<string, string>();
  for (const file of input.proposed) {
    const path = posixRelPath(file.name);
    if (!isManagedSqlPath(path)) continue;
    proposedByPath.set(path, file.sql);
  }

  const existingByPath = new Map<string, string>();
  for (const [raw, content] of input.existing) {
    const path = posixRelPath(raw);
    if (!isManagedSqlPath(path)) continue;
    existingByPath.set(path, content);
  }

  const previouslyOwned =
    input.previouslyOwned === undefined
      ? undefined
      : new Set(
          [...input.previouslyOwned].map(posixRelPath).filter(isManagedSqlPath),
        );

  const created: string[] = [];
  const updated: string[] = [];
  const unchanged: string[] = [];
  for (const [path, sql] of proposedByPath) {
    const change = classifySqlContent(existingByPath.get(path), sql);
    if (change === "created") created.push(path);
    else if (change === "updated") updated.push(path);
    else unchanged.push(path);
  }

  const removed: string[] = [];
  const unmanaged: string[] = [];
  for (const path of existingByPath.keys()) {
    if (proposedByPath.has(path)) continue;
    if (previouslyOwned?.has(path) === true) removed.push(path);
    else unmanaged.push(path);
  }
  removed.sort();
  unmanaged.sort();

  return { created, updated, unchanged, removed, unmanaged };
}
