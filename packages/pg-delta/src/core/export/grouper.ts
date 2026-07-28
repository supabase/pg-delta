/**
 * Group changes into declarative schema files and order them for readability.
 */

import { createHash } from "node:crypto";
import createDebug from "debug";
import type { Change } from "../change.types.ts";
import { getFilePath } from "./file-mapper.ts";
import type { FileCategory, FileMetadata, FilePath } from "./types.ts";
import { CATEGORY_PRIORITY } from "./types.ts";

// ============================================================================
// Types
// ============================================================================

interface FileGroup {
  path: string;
  category: FileCategory;
  metadata: FileMetadata;
  changes: Change[];
}

// ============================================================================
// Within-file ordering
// ============================================================================

const OPERATION_PRIORITY: Record<string, number> = {
  create: 0,
  alter: 1,
};

const SCOPE_PRIORITY: Record<string, number> = {
  object: 0,
  comment: 1,
  privilege: 2,
  default_privilege: 3,
  membership: 4,
};

/**
 * Sort changes within a file for readability:
 * 1. By operation: create → alter
 * 2. By scope: object → comment → privilege → default_privilege → membership
 * 3. Stable tie-break by original position
 */
function sortChangesWithinFile(changes: Change[]): Change[] {
  // Tag each change with its original index for stable tie-breaking.
  const tagged = changes.map((change, index) => ({ change, index }));
  tagged.sort((a, b) => {
    const opA = OPERATION_PRIORITY[a.change.operation] ?? 99;
    const opB = OPERATION_PRIORITY[b.change.operation] ?? 99;
    if (opA !== opB) return opA - opB;

    const scopeA =
      SCOPE_PRIORITY[(a.change as { scope?: string }).scope ?? "object"] ?? 99;
    const scopeB =
      SCOPE_PRIORITY[(b.change as { scope?: string }).scope ?? "object"] ?? 99;
    if (scopeA !== scopeB) return scopeA - scopeB;

    return a.index - b.index;
  });
  return tagged.map((t) => t.change);
}

const debugExport = createDebug("pg-delta:export");

// ============================================================================
// Case-collision disambiguation
// ============================================================================

/** Initial length of the hex hash suffix appended to case-colliding paths. */
const CASE_HASH_LENGTH = 8;

/** Full length of a sha256 hex digest -- upper bound for suffix growth. */
const MAX_CASE_HASH_LENGTH = 64;

function caseHashSuffix(originalPath: string, length: number): string {
  return createHash("sha256")
    .update(originalPath, "utf8")
    .digest("hex")
    .slice(0, length);
}

/** Insert `-<hash>` before the extension: `Users.sql` -> `Users-1a2b3c4d.sql`. */
function appendCaseHash(originalPath: string, length: number): string {
  const suffix = caseHashSuffix(originalPath, length);
  const dot = originalPath.lastIndexOf(".");
  if (dot <= originalPath.lastIndexOf("/")) {
    return `${originalPath}-${suffix}`;
  }
  return `${originalPath.slice(0, dot)}-${suffix}${originalPath.slice(dot)}`;
}

/**
 * Compute renames for paths that differ only by case ("case twins", e.g.
 * `schemas/public/tables/Users.sql` vs `schemas/public/tables/users.sql`).
 *
 * PostgreSQL identifiers are case-sensitive, but the default filesystems on
 * macOS (APFS) and Windows (NTFS) are case-insensitive: both paths resolve to
 * the same physical file and the second write silently overwrites the first.
 * Exports are portable artifacts (written on Linux, checked out on a Mac), so
 * collisions are prevented at write time on every platform.
 *
 * Every member of a colliding set gets a deterministic `-<hash>` suffix
 * derived from its original case-sensitive path, so renames are stable across
 * exports and independent of input order. Non-colliding paths are left
 * untouched (backward compatible).
 *
 * @param paths - Distinct case-sensitive file paths.
 * @returns Map from original path to disambiguated path (colliding paths only).
 */
export function disambiguateCaseCollisions(
  paths: readonly string[],
): Map<string, string> {
  const byFolded = new Map<string, string[]>();
  for (const path of paths) {
    const key = path.toLowerCase();
    const bucket = byFolded.get(key);
    if (bucket) {
      bucket.push(path);
    } else {
      byFolded.set(key, [path]);
    }
  }

  const colliding = new Set<string>();
  for (const bucket of byFolded.values()) {
    if (bucket.length > 1) {
      for (const path of bucket) {
        colliding.add(path);
      }
    }
  }
  if (colliding.size === 0) return new Map();

  // Grow the suffix until the full path set is case-insensitively unique.
  // 8 hex chars is virtually always enough; the loop only guards against the
  // pathological case where a suffixed name collides with an existing object.
  for (
    let length = CASE_HASH_LENGTH;
    length <= MAX_CASE_HASH_LENGTH;
    length++
  ) {
    const renames = new Map<string, string>();
    for (const path of colliding) {
      renames.set(path, appendCaseHash(path, length));
    }

    const folded = new Set<string>();
    let unique = true;
    for (const path of paths) {
      const key = (renames.get(path) ?? path).toLowerCase();
      if (folded.has(key)) {
        unique = false;
        break;
      }
      folded.add(key);
    }
    if (unique) return renames;
  }

  throw new Error("Unable to disambiguate case-colliding export paths");
}

// ============================================================================
// Grouping & Ordering
// ============================================================================

export function groupChangesByFile(
  changes: Change[],
  mapper: (change: Change) => FilePath = getFilePath,
): FileGroup[] {
  const groups = new Map<string, FileGroup>();

  for (const change of changes) {
    const file = mapper(change);

    const existing = groups.get(file.path);
    if (!existing) {
      groups.set(file.path, {
        path: file.path,
        category: file.category,
        metadata: file.metadata,
        changes: [change],
      });
      continue;
    }

    existing.changes.push(change);
  }

  // Sort within each file for readability.
  for (const group of groups.values()) {
    group.changes = sortChangesWithinFile(group.changes);
  }

  const result = Array.from(groups.values());

  // Rename paths that would collide on case-insensitive filesystems
  // (APFS/NTFS), where e.g. `Users.sql` and `users.sql` are one physical file.
  const renames = disambiguateCaseCollisions(result.map((group) => group.path));
  for (const group of result) {
    const renamed = renames.get(group.path);
    if (renamed) {
      debugExport(
        "case-insensitive path collision: renaming '%s' -> '%s'",
        group.path,
        renamed,
      );
      group.path = renamed;
    }
  }

  // Sort files by category priority, then alphabetically by path.
  return result.sort(sortByCategory);
}

/**
 * Sort by category priority, then path for determinism.
 */
function sortByCategory(a: FileGroup, b: FileGroup): number {
  const categoryDiff =
    CATEGORY_PRIORITY[a.category] - CATEGORY_PRIORITY[b.category];
  if (categoryDiff !== 0) return categoryDiff;

  return a.path.localeCompare(b.path);
}
