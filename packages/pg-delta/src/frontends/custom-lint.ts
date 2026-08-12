/**
 * `schema lint` rules for the reserved `_custom/` folder
 * (docs/architecture/custom-folder.md §4).
 *
 * All four are WARNINGS, and they live in lint alone — they are bookkeeping
 * hygiene, and export/apply must not fail on hygiene. They are deliberately NOT
 * part of the export/apply diagnostic set (and so never reachable by
 * `--strict-coverage`).
 *
 *   custom_missing_migration_ref     a custom file records no migration twin
 *   custom_dangling_migration_ref    a recorded path names no file on disk
 *   custom_conflicting_migration_ref `none` mixed with real paths
 *   custom_modeled_kind              modeled DDL parked in `_custom/`
 *
 * What the rules deliberately do NOT check: whether the custom file and its
 * migration are EQUIVALENT (that needs SQL semantics, which the architecture
 * forbids) and whether the migration was APPLIED to a target (pg-delta does not
 * know the migration runner).
 */
import { statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { CUSTOM_DIR_NAME, isCustomPath } from "./custom-dir.ts";
import { parseCustomMigrationDirectives } from "./custom-migration-directive.ts";
import type { SqlFile } from "./load-sql-files.ts";
import type { OrderedSqlFile, StatementProvenance } from "./sql-order.ts";

/** One lint finding about a `_custom/` file. Rendered by the CLI, which owns the
 *  `WARNING [code] location: message` shape and resolves `location` to
 *  `file:line:col`. */
export interface CustomLintFinding {
  code: string;
  message: string;
  /** The custom file, as authored relative to the lint root. */
  file: string;
  /** Statement-level provenance, for a finding about one statement. */
  location?: StatementProvenance;
}

export interface LintCustomMigrationRefsOptions {
  /** Probe deciding whether a resolved migration path names a readable regular
   *  FILE. Injectable for tests; defaults to {@link isRegularFile}. */
  isFile?: (absolutePath: string) => boolean;
  /**
   * `custom_missing_migration_ref` only. `"off"` is for frontends that maintain
   * the directive THEMSELVES (fold-into-migration delivery — see
   * custom-files.ts): under those, an absent directive means "not folded in
   * yet", which is the frontend's business and not a finding to nag the user
   * about. Default `"warn"`.
   *
   * Deliberately scoped to the missing rule: the dangling and conflicting rules
   * are never suppressible, because a recorded-but-WRONG reference is a bug no
   * matter who wrote it.
   */
  missingRef?: "warn" | "off";
}

/**
 * Whether `absolutePath` names a regular FILE. A migration reference points at a
 * migration, so mere EXISTENCE is not enough: `-- pgdelta-migration: ../migrations`
 * names a directory and records nothing about which migration delivered the
 * custom file, so it has to read as a broken reference rather than a satisfied
 * one. `statSync` follows symlinks, so a symlink to a migration still counts.
 */
function isRegularFile(absolutePath: string): boolean {
  try {
    return statSync(absolutePath).isFile();
  } catch {
    return false; // absent, or unreadable — either way, not a usable reference
  }
}

/** A Windows drive-letter absolute path (`C:\...` / `C:/...`), so a lint run on
 *  a non-Windows machine still flags one — `path.isAbsolute` alone only
 *  recognizes the host platform's own convention. */
const WINDOWS_DRIVE_ABSOLUTE = /^[A-Za-z]:[\\/]/;

/**
 * Whether a directive VALUE is absolute rather than relative to the custom
 * file's directory (§3). `resolve(base, value)` silently discards `base` for
 * an absolute `value`, so an existing absolute path would otherwise pass the
 * dangling-ref check even though it is machine-specific bookkeeping that
 * breaks on any other checkout — this must be rejected before resolving.
 */
function isAbsoluteDirectivePath(value: string): boolean {
  return isAbsolute(value) || WINDOWS_DRIVE_ABSOLUTE.test(value);
}

/**
 * Check the `-- pgdelta-migration:` bookkeeping of every `_custom/**` file in
 * `files` (paths relative to `root`, as `collectSqlFiles` produces them). Files
 * outside the reserved folder are ignored entirely.
 *
 * Directive paths resolve against the directory containing the custom file, so a
 * tree is self-contained — there is no "migrations directory" to configure.
 */
export function lintCustomMigrationRefs(
  root: string,
  files: readonly SqlFile[],
  options: LintCustomMigrationRefsOptions = {},
): CustomLintFinding[] {
  const isFile = options.isFile ?? isRegularFile;
  const findings: CustomLintFinding[] = [];
  for (const file of files) {
    if (!isCustomPath(file.name)) continue;
    const { paths, hasNone } = parseCustomMigrationDirectives(file.sql);
    if (hasNone && paths.length > 0) {
      findings.push({
        code: "custom_conflicting_migration_ref",
        file: file.name,
        message:
          `declares "-- pgdelta-migration: none" together with ${paths.length} ` +
          `migration path(s) (${paths.join(", ")}); keep one or the other`,
      });
      continue;
    }
    if (hasNone) continue; // deliberate opt-out: nothing to resolve
    if (paths.length === 0) {
      if (options.missingRef === "off") continue;
      findings.push({
        code: "custom_missing_migration_ref",
        file: file.name,
        message:
          `no "-- pgdelta-migration: <path>" directive at the top of the file; ` +
          `${CUSTOM_DIR_NAME}/ feeds the shadow only, so record the migration that ` +
          `delivers this SQL to your targets (or "none" if it deliberately has no twin)`,
      });
      continue;
    }
    const base = dirname(resolve(root, file.name));
    for (const relative of paths) {
      if (isAbsoluteDirectivePath(relative)) {
        findings.push({
          code: "custom_dangling_migration_ref",
          file: file.name,
          message:
            `migration reference "${relative}": absolute path not allowed; ` +
            `use a path relative to the custom file`,
        });
        continue;
      }
      if (isFile(resolve(base, relative))) continue;
      findings.push({
        code: "custom_dangling_migration_ref",
        file: file.name,
        message:
          `migration reference "${relative}" does not name a file (resolved ` +
          `against ${base}); fix the path or update it after moving the migration`,
      });
    }
  }
  return findings;
}

/**
 * pg-topo statement classes that pg-delta MODELS, and therefore regenerates into
 * the managed tree on the next `schema export`. One of these parked in
 * `_custom/` becomes a duplicate `CREATE` the shadow loader can never converge
 * on (`max_rounds_exceeded`) — so the rule is exactly: modeled-by-pg-delta ⇒
 * warn (see COVERAGE.md for the authoritative model map).
 *
 * Everything else stays silent, which is the folder's whole purpose:
 * - casts, operators, operator classes/families, text-search objects,
 *   statistics objects, transforms and foreign tables classify as `UNKNOWN`
 *   (pg-topo has no class for them), as do bare INSERT/DELETE — the unmodeled
 *   DDL and idempotent DML `_custom/` exists to hold;
 * - `SELECT` / `UPDATE` / `DO` / `VARIABLE_SET` are DML or session plumbing,
 *   never desired-state DDL;
 * - `CREATE_LANGUAGE` is an unmodeled kind (`unmodeled.ts` probes it), so a
 *   user language legitimately lives here;
 * - `ALTER_OWNER` and `COMMENT` are excluded even though ownership and comments
 *   ARE modeled. Both classes are TARGET-BLIND: pg-topo gives `COMMENT ON TEXT
 *   SEARCH CONFIGURATION` (metadata for an unmodeled object, exactly what this
 *   folder holds) and `COMMENT ON TABLE` the same class, as it does for
 *   `ALTER OPERATOR … OWNER TO` and `ALTER TABLE … OWNER TO`. Inside `_custom/`
 *   the target is more likely to be an unmodeled object, so flagging the class
 *   fires on the folder's own documented use — and a false positive here trains
 *   operators to ignore the rule. The deliberate trade-off is a false NEGATIVE:
 *   a `COMMENT ON TABLE` parked here goes unflagged (its duplicate surfaces
 *   loudly at the next `schema apply`, which cannot converge). Revisit if
 *   pg-topo ever classifies these per target kind.
 * - `GRANT` and `REVOKE` are excluded for the SAME target-blind reason, even
 *   though privileges ARE modeled (as ACL facts on the target object). pg-topo
 *   gives `GRANT USAGE ON LANGUAGE my_language TO app` (an ACL on an unmodeled
 *   `CREATE_LANGUAGE` object, exactly what this folder legitimately holds) the
 *   same `GRANT` class as `GRANT SELECT ON TABLE public.t TO app`. Flagging the
 *   class would fire on the folder's own documented use for the same false
 *   positive vs. false negative trade-off as `ALTER_OWNER`/`COMMENT` above.
 *   `ALTER_DEFAULT_PRIVILEGES` stays IN the set: it has no unmodeled-target
 *   reading — default privileges are keyed to a (grantor, schema) pair, which
 *   is always a modeled object, so an ADP statement parked here is always a
 *   genuine duplicate, never a legitimate exclusion.
 */
const MODELED_STATEMENT_CLASSES: ReadonlySet<string> = new Set([
  "ALTER_DEFAULT_PRIVILEGES",
  "ALTER_PUBLICATION",
  "ALTER_SEQUENCE",
  "ALTER_SUBSCRIPTION",
  "ALTER_TABLE",
  "CREATE_AGGREGATE",
  "CREATE_COLLATION",
  "CREATE_DOMAIN",
  "CREATE_EVENT_TRIGGER",
  "CREATE_EXTENSION",
  "CREATE_FOREIGN_DATA_WRAPPER",
  "CREATE_FOREIGN_SERVER",
  "CREATE_FUNCTION",
  "CREATE_INDEX",
  "CREATE_MATERIALIZED_VIEW",
  "CREATE_POLICY",
  "CREATE_PROCEDURE",
  "CREATE_PUBLICATION",
  "CREATE_ROLE",
  "CREATE_RULE",
  "CREATE_SCHEMA",
  "CREATE_SEQUENCE",
  "CREATE_SUBSCRIPTION",
  "CREATE_TABLE",
  "CREATE_TRIGGER",
  "CREATE_TYPE",
  "CREATE_VIEW",
]);

/**
 * Warn for every statement inside `_custom/` whose pg-topo class names a kind
 * pg-delta models. Takes the analyzed statements from
 * {@link analyzeForShadow} (`ShadowOrderResult.files`), so lint pays for one
 * parse, and statements whose class pg-topo did not resolve are simply skipped.
 *
 * Findings come back in authored order (file, then statement index) so the lint
 * output reads top-to-bottom through each file rather than in topological order.
 */
export function lintCustomModeledKinds(
  statements: readonly OrderedSqlFile[],
): CustomLintFinding[] {
  const findings = statements
    .filter(
      (statement) =>
        isCustomPath(statement.provenance.filePath) &&
        statement.statementClass !== undefined &&
        MODELED_STATEMENT_CLASSES.has(statement.statementClass),
    )
    .map((statement) => ({
      code: "custom_modeled_kind",
      file: statement.provenance.filePath,
      location: statement.provenance,
      message:
        `${statement.statementClass} is a kind pg-delta models, so the next ` +
        `\`schema export\` regenerates it into the managed tree — keeping it in ` +
        `${CUSTOM_DIR_NAME}/ makes it a duplicate the shadow load cannot converge on`,
    }));
  findings.sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      (a.location?.statementIndex ?? 0) - (b.location?.statementIndex ?? 0),
  );
  return findings;
}
