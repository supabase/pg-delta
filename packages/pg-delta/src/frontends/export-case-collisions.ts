/**
 * Fold export paths that collide on case-insensitive filesystems into one
 * shared file.
 *
 * PostgreSQL identifiers are case-sensitive (`"Users"` and `"users"` are
 * distinct objects), but the default filesystems on macOS (APFS) and Windows
 * (NTFS) are not: two export paths differing only by case resolve to ONE
 * physical file, so the second write silently overwrites the first — an
 * object vanishes from the export with no diagnostic, and apply wedges on the
 * missing object's dependents (issue #365). Exports are portable artifacts
 * (written on Linux, checked out on a Mac), so the collision is prevented at
 * write time on EVERY platform, not detected on the affected ones.
 *
 * Every path SEGMENT with case-twin spellings folds to a canonical spelling —
 * the lexicographically smallest spelling actually present:
 *
 * - Case-twin FILES merge into one shared file (`Users.sql` + `users.sql` →
 *   both objects' DDL in `Users.sql`): multi-object files are already
 *   first-class in the export/loader contract, so no name is invented and the
 *   shared file sits exactly where a reader would look.
 * - Every descendant of case-twin DIRECTORIES agrees on the parent's casing
 *   (`schemas/App/…` + `schemas/app/…` → one `schemas/App/…` tree), so the
 *   manifest matches the single physical directory APFS/NTFS create and a
 *   re-export cannot misread its own files as unmanaged (PR #368 review).
 *
 * Each SEGMENT's canonical spelling is a spelling some member actually uses —
 * never an invented one (e.g. all-lowercase) — so a same-directory twin set
 * always merges into a member path, a lone spelling is never rewritten, and
 * adding a twin that sorts after an existing file merges INTO the existing
 * path: stable across re-exports and input order. (Under MULTI-SEGMENT
 * divergence with opposite lexical winners the composed whole path can be a
 * combination no single object produced — `schemas/App/tables/foo.sql` +
 * `schemas/app/tables/FOO.sql` → `schemas/App/tables/FOO.sql` — which is
 * fine: the export owns every destination it writes; see the PR #368 triage
 * section in docs/roadmap/pg-delta-next-follow-ups.md for the deliberately
 * deferred hardening around pre-existing out-dir content.) Non-colliding
 * paths — all of them, in practice — are never touched.
 */

interface TrieNode {
  /** Distinct spellings seen for this segment (same case-folded key). */
  spellings: Set<string>;
  /** Child segments, keyed by their case-folded spelling. */
  children: Map<string, TrieNode>;
  /** Memoized {@link canonicalSpelling} — computed once per node, not once
   *  per path, so a large colliding bucket stays O(N) instead of O(N²)
   *  (PR #368 review). */
  canonical?: string;
}

function childOf(node: TrieNode, segment: string): TrieNode {
  const key = segment.toLowerCase();
  let child = node.children.get(key);
  if (child === undefined) {
    child = { spellings: new Set(), children: new Map() };
    node.children.set(key, child);
  }
  child.spellings.add(segment);
  return child;
}

/** The lexicographically smallest spelling — the deterministic canonical
 *  representative of a case-twin segment. */
function canonicalSpelling(spellings: ReadonlySet<string>): string {
  let smallest: string | undefined;
  for (const spelling of spellings) {
    if (smallest === undefined || spelling < smallest) smallest = spelling;
  }
  return smallest!;
}

/**
 * Map every path whose spelling changes under case-collision folding to its
 * canonical path. Paths already canonical (including every non-colliding
 * path, and duplicate mentions of one path — already one file) are absent
 * from the map. Each colliding set is reported once through `onWarning`.
 */
export function foldCaseCollidingPaths(
  paths: Iterable<string>,
  onWarning?: (message: string) => void,
): Map<string, string> {
  const distinct = new Set(paths);
  const root: TrieNode = { spellings: new Set(), children: new Map() };
  for (const path of distinct) {
    let node = root;
    for (const segment of path.split("/")) {
      node = childOf(node, segment);
    }
  }

  const folds = new Map<string, string>();
  const byCanonical = new Map<string, string[]>();
  for (const path of distinct) {
    let node = root;
    const segments = path.split("/").map((segment) => {
      node = node.children.get(segment.toLowerCase())!;
      return node.spellings.size > 1
        ? (node.canonical ??= canonicalSpelling(node.spellings))
        : segment;
    });
    const canonical = segments.join("/");
    if (canonical !== path) folds.set(path, canonical);
    const members = byCanonical.get(canonical);
    if (members === undefined) {
      byCanonical.set(canonical, [path]);
    } else {
      members.push(path);
    }
  }

  if (onWarning !== undefined) {
    for (const [canonical, members] of byCanonical) {
      if (members.length > 1) {
        const sorted = [...members].sort((a, b) =>
          a < b ? -1 : a > b ? 1 : 0,
        );
        onWarning(
          `export paths ${sorted.map((m) => `"${m}"`).join(", ")} differ ` +
            `only by case and would be one physical file on case-insensitive ` +
            `filesystems (APFS/NTFS); merging them into "${canonical}"`,
        );
      } else if (members[0] !== canonical) {
        onWarning(
          `export path "${members[0]}" sits under a directory whose name ` +
            `differs only by case from another export path's; writing it as ` +
            `"${canonical}" so the tree has one spelling on case-insensitive ` +
            `filesystems (APFS/NTFS)`,
        );
      }
    }
  }
  return folds;
}
