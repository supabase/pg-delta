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
 *   custom_dangling_migration_ref    a recorded migration path is not on disk
 *   custom_conflicting_migration_ref `none` mixed with real paths
 *   custom_modeled_kind              modeled DDL parked in `_custom/`
 *
 * What the rules deliberately do NOT check: whether the custom file and its
 * migration are EQUIVALENT (that needs SQL semantics, which the architecture
 * forbids) and whether the migration was APPLIED to a target (pg-delta does not
 * know the migration runner).
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
  /** Existence probe for a resolved migration path. Injectable for tests;
   *  defaults to `existsSync`. */
  exists?: (absolutePath: string) => boolean;
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
  const exists = options.exists ?? existsSync;
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
      if (exists(resolve(base, relative))) continue;
      findings.push({
        code: "custom_dangling_migration_ref",
        file: file.name,
        message:
          `migration reference "${relative}" does not exist (resolved against ` +
          `${base}); fix the path or update it after moving the migration`,
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
 * - `ALTER_OWNER` is excluded even though ownership IS modeled: `ALTER OPERATOR
 *   … OWNER TO` and friends classify the same way, and inside `_custom/` an
 *   owner change is more likely to target an unmodeled object than a modeled
 *   one — a false positive here would train operators to ignore the rule.
 */
const MODELED_STATEMENT_CLASSES: ReadonlySet<string> = new Set([
  "ALTER_DEFAULT_PRIVILEGES",
  "ALTER_PUBLICATION",
  "ALTER_SEQUENCE",
  "ALTER_SUBSCRIPTION",
  "ALTER_TABLE",
  "COMMENT",
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
  "GRANT",
  "REVOKE",
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
