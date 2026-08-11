/**
 * Reading the reserved `_custom/` folder as DATA, for frontends that automate
 * delivery (docs/architecture/custom-folder.md §7, Phase 2).
 *
 * `_custom/` holds SQL pg-delta detects but does not model. It feeds the SHADOW
 * only: unmodeled objects produce no facts, so nothing in this folder can ever
 * enter a plan, and pg-delta executes none of it against a target — that is a
 * permanent non-goal, not a missing feature. The target reaches parity through
 * the same channel everything else uses: a migration.
 *
 * A frontend that OWNS that channel (the Supabase CLI, say) can close the loop
 * on the user's behalf, and this helper is the seam for it:
 *
 *   1. `listCustomFiles(root)` — every `_custom/**\/*.sql` with its body and its
 *      parsed `-- pgdelta-migration:` directives;
 *   2. the frontend appends each `delivered === false` file's SQL to the
 *      catch-up migration it is already generating, and stamps the directive
 *      back into the custom file, which records the delivery;
 *   3. run-once semantics come free from the migration ledger the frontend
 *      already maintains — pg-delta grows no ledger of its own (§7).
 *
 * Under such a frontend the user never maintains the directive by hand, so
 * `schema lint --custom-migration-refs off` turns off the
 * `custom_missing_migration_ref` nag (the dangling and conflicting rules stay
 * on: a recorded-but-wrong reference is a bug whoever wrote it).
 *
 * Nothing here interprets SQL — discovery is by extension, the directive parse
 * is lexical (custom-migration-directive.ts), and the body is carried verbatim.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { CUSTOM_DIR_NAME } from "./custom-dir.ts";
import { parseCustomMigrationDirectives } from "./custom-migration-directive.ts";

/** One `.sql` file inside the reserved folder, with its delivery bookkeeping. */
export interface CustomFile {
  /** Path relative to the export root, POSIX-separated and `_custom/`-prefixed
   *  (e.g. `_custom/nested/casts.sql`) — stable across platforms, so a frontend
   *  can put it in a generated migration's comment header. */
  path: string;
  /** The file body, verbatim. */
  sql: string;
  /** `-- pgdelta-migration: <path>` values, in file order, relative to the
   *  directory holding the custom file. */
  migrations: string[];
  /** Whether the file declares `-- pgdelta-migration: none`. */
  hasNone: boolean;
  /**
   * Whether the file's delivery is ACCOUNTED FOR — a recorded migration, or an
   * explicit `none`. False means "no directive at all": the fold-into-migration
   * candidate. This is bookkeeping, not proof: pg-delta does not know the
   * migration runner, so it cannot tell whether a recorded migration ever ran on
   * a given target. The `unmodeled_drift` diagnostic (extract/unmodeled.ts)
   * answers that question at the catalog level instead.
   */
  delivered: boolean;
}

/** Recursively collect `.sql` paths under `dir`, lexicographic, as POSIX paths
 *  relative to `dir` — the same ordering convention `collectSqlFiles` uses.
 *  Local rather than shared so this library frontend keeps no dependency on the
 *  CLI layer that happens to host that walker today. */
function collectSqlPaths(dir: string, prefix: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir).sort();
  } catch {
    return []; // absent (or unreadable) `_custom/` is simply "no custom files"
  }
  const found: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...collectSqlPaths(full, `${prefix}${entry}/`));
    } else if (entry.endsWith(".sql")) {
      found.push(`${prefix}${entry}`);
    }
  }
  return found;
}

/**
 * Every `.sql` file under `<root>/_custom/`, in lexicographic order, with its
 * body and parsed migration directives. Returns `[]` when the reserved folder
 * does not exist — the overwhelmingly common case, and not an error.
 *
 * Non-`.sql` files are skipped, so the scaffolded `README.md` never appears.
 */
export function listCustomFiles(root: string): CustomFile[] {
  const customRoot = join(root, CUSTOM_DIR_NAME);
  return collectSqlPaths(customRoot, `${CUSTOM_DIR_NAME}/`).map((path) => {
    // `path` is POSIX-relative to `root`; re-split it for the fs read so the
    // helper works on Windows too.
    const sql = readFileSync(join(root, ...path.split("/")), "utf8");
    const { paths, hasNone } = parseCustomMigrationDirectives(sql);
    return {
      path,
      sql,
      migrations: paths,
      hasNone,
      delivered: hasNone || paths.length > 0,
    };
  });
}
