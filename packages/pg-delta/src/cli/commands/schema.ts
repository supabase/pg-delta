/**
 * schema export --source <pg-url> --out-dir <dir> [--layout by-object|ordered|grouped]
 *   Export the source database as SQL files written to disk.
 *   Maps to old `declarative-export`.
 *
 *   --path-style flat|nested (any layout) — where the two ROOT segments live.
 *     flat (default): schema directories at the export root and cluster-level
 *       files under `_cluster/` — `app/tables/t.sql`, `_cluster/roles.sql`.
 *       A schema named `_cluster` / `_custom` — the two reserved root
 *       directories — or any CASE VARIANT of one escapes its leading
 *       underscore: `%5Fcluster/`, `%5FCUSTOM/`.
 *     nested: the historical `schemas/app/tables/t.sql` + `cluster/roles.sql`
 *       tree, for callers whose tooling pins those paths.
 *
 *   Layouts:
 *     by-object (default) — the familiar tree (<s>/tables/<t>.sql, …),
 *       files in dependency/plan order.
 *     ordered — numbered files in plan order; the loader converges in one pass.
 *     grouped — the old engine's "nice" export: files ordered by semantic
 *       category (cluster → schema → types → tables → views → …), statements
 *       sorted within a file for readability, plus opt-in grouping:
 *         --grouping-mode single-file|subdirectory  (default subdirectory)
 *         --group-patterns '[{"pattern":"^auth_","name":"auth"}]'  (first match wins)
 *         --flat-schemas partman,audit   (collapse a schema to one file/category)
 *         --no-group-partitions          (keep partition children in their own files)
 *
 *   --format-options '<json>'  (any layout) — pretty-print each file's SQL with
 *     the formatter (frontends/sql-format), e.g. '{"keywordCase":"upper","maxWidth":180}'.
 *     Off by default (raw renderer output). Cosmetic — load(export) ≡ db still holds.
 *
 *   The export OWNS its directory (`.pgdelta-export.json` records the files it
 *   wrote): a re-export prunes what the previous one owned and REFUSES when it
 *   finds a `.sql` it does not own (--prune-unmanaged deletes those instead).
 *   The one exception is the reserved root-level `_custom/` directory
 *   (frontends/custom-dir.ts): never written into (a collision is a hard error),
 *   never pruned — not even with --prune-unmanaged — never reported unmanaged,
 *   never recorded in the manifest. Its `README.md` is scaffolded once. That is
 *   where SQL the engine detects but does not model (`unmodeled_kind`: casts,
 *   operators, text-search objects, …) and idempotent DML live, so re-exports
 *   preserve them and the shadow can elaborate modeled dependents.
 *
 * schema apply --dir <dir> [--shadow <pg-url>] --target <pg-url>
 *              [--renames auto|prompt|off] [--force]
 *              [--accept-rename <from>=<to>] (repeatable) [--no-reorder]
 *              [--dry-run] [--verbose] [--out-plan <plan.json>]
 *   Read .sql files recursively (lexicographic), load into shadow, extract
 *   target, plan, apply.  Maps to old `declarative-apply` / `sync`.
 *
 *   The recursive read includes `_custom/**\/*.sql`, which is how that folder
 *   feeds the SHADOW. Nothing in it is ever executed against the target: it is
 *   loaded, extracted, and whatever it created that the engine does not model
 *   produces no facts and therefore cannot enter a plan.
 *
 *   Which is why planning also PRE-FLIGHTS that gap: an `unmodeled_drift`
 *   warning (labelled `[drift]`) names every unmodeled object the shadow has and
 *   the target lacks, because no planned statement can create one and a planned
 *   statement depending on one will fail on the target. Deliver it through your
 *   migration channel first. `--strict-coverage` makes it blocking.
 *
 *   Shadow load tries authored / export `loadOrder` first (then reconnects
 *   once if the session looks poisoned). `--no-reorder` skips the later
 *   file-kind / statement-kind escalate so a stuck load stays stuck.
 *
 *   --accept-rename <from>=<to>
 *     Confirm one rename candidate by the encoded stable-ids shown in a prior
 *     --renames prompt run.  Repeatable; each flag names one confirmed rename.
 *
 *   The statements actually applied to the target are NOT the authored
 *   declarative SQL: the planner re-derives atomic DDL from the catalog diff
 *   between the shadow (desired) and target (current) states. --verbose shows
 *   every statement actually executed on the target connection — including
 *   transaction framing (BEGIN/COMMIT/ROLLBACK) and session SETs — never the
 *   authored files; --dry-run prints a portable executable script containing
 *   the same successful-path statements and segment boundaries, without
 *   applying them. It must be dispatched statement by statement on one session,
 *   stopping at the first error, with autocommit outside its explicit
 *   transaction blocks; never submit it as one multi-statement request or wrap
 *   the whole script in one transaction.
 *
 *   --dry-run
 *     Plan as usual, then print the executable portable SQL script to STDOUT
 *     instead of calling apply() — no fingerprint gate runs, nothing is
 *     applied. Execute it statement by statement on one session and stop on
 *     the first error; preserve autocommit outside its explicit transaction
 *     blocks. A stderr summary reports the action count and flags any
 *     destructive actions. Composes with --out-plan; --force is a no-op since
 *     the gate never runs, and --verbose has no effect (nothing executes, so
 *     there is no trace).
 *   --verbose
 *     During the real apply, stream a segment/action-level progress trace to
 *     STDERR: segment start/end (with outcome), every planner-rendered action
 *     (the SQL about to run and whether it succeeded, with wall-clock timing),
 *     AND every other statement sent on the same connection — BEGIN, preamble
 *     SET/SET LOCAL, COMMIT, ROLLBACK, RESET ALL — prefixed `  ; ` to stay
 *     visually distinct from action lines. Wraps apply()'s `onEvent` observer
 *     hook (src/apply/apply.ts) — purely additive, never changes what gets
 *     applied or the final report.
 *   --out-plan <plan.json>
 *     Write the plan artifact (the same format `plan --out` produces) to this
 *     path right after planning, before apply (or the --dry-run script). Useful
 *     for inspecting/archiving the exact plan a `schema apply` run executed.
 *
 * schema lint --dir <dir> [--custom-migration-refs warn|off]
 *   Static analysis only — no database. Reports the pg-topo findings (cycles,
 *   unknown statement classes, duplicate producers, …) plus the `_custom/`
 *   bookkeeping rules (frontends/custom-lint.ts), all as non-blocking warnings:
 *   custom_missing_migration_ref / custom_dangling_migration_ref /
 *   custom_conflicting_migration_ref (the `-- pgdelta-migration:` head-of-file
 *   directive) and custom_modeled_kind (modeled DDL parked in `_custom/`, which
 *   the next export would duplicate). Hygiene lives in lint alone: export and
 *   apply never fail on it, and --strict-coverage cannot reach these codes.
 *
 *   --custom-migration-refs warn|off   (default warn)
 *     `off` silences custom_missing_migration_ref only — for frontends that
 *     maintain the directive themselves by folding undelivered custom files into
 *     a generated migration (frontends/custom-files.ts `listCustomFiles`). The
 *     dangling and conflicting rules always fire: a recorded-but-WRONG reference
 *     is a bug whoever wrote it.
 */
import type { Pool } from "pg";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, dirname, relative, resolve, sep } from "node:path";
import type {
  ExportGrouping,
  ExportGroupingPattern,
  ExportPathStyle,
} from "../../frontends/export-sql-files.ts";
import type { SqlFormatOptions } from "../../frontends/sql-format/index.ts";
import {
  classifySqlContent,
  type SqlFileChange,
} from "../../frontends/classify-sql-files.ts";
import { pruneStaleSqlFiles } from "../../frontends/prune-sql-files.ts";
import {
  CUSTOM_DIR_NAME,
  CUSTOM_README_NAME,
  isCustomPath,
  scaffoldCustomReadme,
} from "../../frontends/custom-dir.ts";
import {
  lintCustomMigrationRefs,
  lintCustomModeledKinds,
  type CustomLintFinding,
} from "../../frontends/custom-lint.ts";
import {
  readExportManifest,
  writeExportManifest,
} from "../../frontends/export-manifest.ts";
import {
  ShadowLoadError,
  type SqlFile,
} from "../../frontends/load-sql-files.ts";
import { analyzeForShadow } from "../../frontends/sql-order.ts";
import { buildSchemaExport } from "../../frontends/schema-export.ts";
import {
  planSchemaFiles,
  prepareSchemaFiles,
} from "../../frontends/schema-plan.ts";
import {
  appendShadowCycleHint,
  formatLintReport,
  formatStatementLocation,
  rewriteReorderedShadowError,
} from "../reorder-display.ts";
import { serializePlan } from "../../plan/artifact.ts";
import type { ManagementScope } from "../../policy/view.ts";
import { apply, type ApplyEvent } from "../../apply/apply.ts";
import { renderApplyScript } from "../../frontends/render-apply-script.ts";
import { isDestructiveAction } from "../render.ts";
import { encodeId, parseId, type StableId } from "../../core/stable-id.ts";
import { exitIfBlocking, printDiagnostics } from "../diagnostics.ts";
import { makePool } from "../pool.ts";
import {
  type CoLocatedShadow,
  isShadowProvisionError,
  provisionCoLocatedShadow,
} from "../shadow.ts";
import { CliExit, parseFlags, UsageError } from "../flags.ts";
import { effectiveProfileId, PROFILE_IDS, profileById } from "../profile.ts";
import type { RenameMode } from "../../plan/renames.ts";
import { assertDataLossAllowed } from "../data-loss-safety.ts";
import {
  connectionEndpointHash,
  isSameDatabase,
  isSamePostgresLineage,
  isTrustedLocalConnection,
  observeDatabaseIdentityForMutation,
  type ObservedDatabaseIdentity,
} from "../connection-safety.ts";

export async function observeExplicitShadowIdentities(
  targetPool: Pool,
  shadowPool: Pool,
): Promise<{
  targetIdentity: ObservedDatabaseIdentity;
  shadowIdentity: ObservedDatabaseIdentity;
}> {
  // Probe sequentially so a failure always names one connection and two denied
  // roles cannot race to produce a nondeterministic remediation message.
  const targetIdentity = await observeDatabaseIdentityForMutation(
    targetPool,
    "schema apply target safety",
  );
  const shadowIdentity = await observeDatabaseIdentityForMutation(
    shadowPool,
    "schema apply shadow safety",
  );
  return { targetIdentity, shadowIdentity };
}

/** Recursively collect *.sql files in lexicographic order. Exported for tests. */
export function collectSqlFiles(dir: string): SqlFile[] {
  // Derive names from the NORMALIZED root, not by slicing the raw `--dir` string:
  // a trailing slash or non-normalized segment would make `dir.length + 1` drop
  // the first character of every relative path (`01_schema.sql` → `1_schema.sql`),
  // corrupting the lexicographic order the raw loader relies on (review P2).
  const root = resolve(dir);
  const result: SqlFile[] = [];
  const recurse = (current: string): void => {
    const entries = readdirSync(current).sort();
    for (const entry of entries) {
      const full = join(current, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        recurse(full);
      } else if (entry.endsWith(".sql")) {
        result.push({
          name: relative(root, full), // relative path from the normalized dir
          sql: readFileSync(full, "utf8"),
        });
      }
    }
  };
  recurse(root);
  return result;
}

/**
 * Write the exported SQL files and the `.pgdelta-export.json` manifest under
 * `outRoot`, returning the stale files pruned plus a per-file classification
 * of the written set (`created` / `updated` / `unchanged`, as absolute paths
 * like `removed`). A byte-identical file is NOT rewritten, so mtimes stay
 * stable for build tools watching the directory. Exported for tests.
 *
 * Creates `outRoot` up front: a database with no managed objects legitimately
 * yields zero files, and the per-file loop (which only mkdirs each file's parent)
 * would then never create the root, so the manifest write would ENOENT (review
 * P2). Stale `.sql` files the PREVIOUS export owned (recorded in that export's
 * manifest `files` list) are pruned first so a dropped object's file can't
 * linger and be reloaded. A `.sql` file the previous export did NOT own — hand
 * authored SQL, or every `.sql` in a pre-feature / manifest-less dir — is
 * UNMANAGED: rather than silently deleting it (`schema apply --dir` loads the
 * whole tree, so a lingering unmanaged file is a real hazard), the export is
 * refused with an error naming each such file and telling the operator to pass
 * `--prune-unmanaged` (threaded here as `pruneUnmanaged`) to delete them. The
 * new manifest records the owned files as SORTED relative POSIX paths so the
 * next re-export knows what it may prune.
 *
 * The reserved root-level `_custom/` folder (frontends/custom-dir.ts) is outside
 * all of that: the pruner never scans it, so it is never `unmanaged` (no
 * refusal) and never deleted; the exporter refuses to WRITE into it; and it never
 * appears in the manifest's owned `files`. Its `README.md` is scaffolded once so
 * the contract is discoverable in the tree itself.
 */
export function writeExportFiles(
  outRoot: string,
  files: SqlFile[],
  manifest: {
    redactSecrets: boolean;
    profile?: string;
    scope?: "database" | "cluster";
    baselineDigest?: string;
    defaultOwner?: string | null;
  },
  pruneUnmanaged: boolean,
): {
  removed: string[];
  unmanaged: string[];
  created: string[];
  updated: string[];
  unchanged: string[];
  /** whether this export wrote the `_custom/README.md` scaffold */
  scaffoldedCustomReadme: boolean;
  /** whether the scaffold was skipped because `_custom` is a symlink */
  customReadmeSkippedSymlink: boolean;
} {
  // Normalize ONCE: the manifest's owned paths resolve to absolute paths, so
  // every path compared against them (the keep set, the pruner's scan) must
  // be absolute too — with a relative --out-dir the pruner otherwise misreads
  // its own current files as out-of-set and deletes-then-rewrites them on
  // every re-export (PR #368 review).
  outRoot = resolve(outRoot);
  // The PREVIOUS export's owned-file list, read before we write anything. Absent
  // manifest / no `files` field → undefined → every out-of-set `.sql` is
  // unmanaged (pre-feature or hand-authored dir).
  const previous = readExportManifest(outRoot);
  const previouslyOwned =
    previous?.files !== undefined
      ? new Set(previous.files.map((rel) => resolve(outRoot, rel)))
      : undefined;
  const keep = new Set(files.map((file) => join(outRoot, file.name)));
  const { removed, unmanaged } = pruneStaleSqlFiles(
    outRoot,
    keep,
    previouslyOwned,
    pruneUnmanaged,
  );
  // Refuse BEFORE writing any file: deleting hand-authored SQL is irreversible.
  if (unmanaged.length > 0) {
    throw new Error(
      `export: refusing to overwrite ${outRoot}: it contains ${unmanaged.length} ` +
        `unmanaged .sql file(s) this export does not own:\n` +
        unmanaged.map((f) => `  ${f}`).join("\n") +
        `\nPass --prune-unmanaged to delete them and take ownership of the directory.`,
    );
  }
  // Refuse BEFORE writing anything, like the unmanaged check: no layout emits a
  // `_custom/…` path (the flat style escapes a schema of that name — and of any
  // CASE VARIANT of it — to `%5Fcustom/`), so this is unreachable — but the
  // reservation must be ENFORCED where files are written, not assumed, since
  // writing there would silently overwrite hand-authored SQL the pruner is
  // protecting. Matched case-INSENSITIVELY here: on APFS/NTFS a `_CUSTOM/…`
  // path resolves into the reserved directory just the same, and unlike the
  // unmanaged check there is no exported path to collide with that would
  // surface it (Codex review, PR #430).
  const reserved = files.filter((file) =>
    isCustomPath(file.name.toLowerCase()),
  );
  if (reserved.length > 0) {
    throw new Error(
      `export: refusing to write into the reserved ${CUSTOM_DIR_NAME}/ directory:\n` +
        reserved.map((file) => `  ${file.name}`).join("\n"),
    );
  }
  mkdirSync(outRoot, { recursive: true });
  const created: string[] = [];
  const updated: string[] = [];
  const unchanged: string[] = [];
  for (const file of files) {
    const full = join(outRoot, file.name);
    // defense-in-depth (review P2): even with per-segment encoding in
    // exportSqlFiles, never let a database identifier escape the output dir.
    if (full !== outRoot && !full.startsWith(outRoot + sep)) {
      throw new Error(
        `export: refusing to write outside ${outRoot}: ${file.name}`,
      );
    }
    // Classify against the file already on disk via the shared helper
    // (frontends/classify-sql-files.ts). A size mismatch alone proves the
    // content differs, so the old content is only buffered for a plausible
    // match. Only ENOENT means "created" — any other stat/read error is
    // surfaced rather than silently reclassified as absence (PR #405 review).
    let status: SqlFileChange;
    try {
      status =
        statSync(full).size !== Buffer.byteLength(file.sql, "utf8")
          ? "updated"
          : classifySqlContent(readFileSync(full, "utf8"), file.sql);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error(
          `export: cannot read existing file ${full} to classify it: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      status = classifySqlContent(undefined, file.sql);
    }
    if (status === "unchanged") {
      unchanged.push(full);
      continue;
    }
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, file.sql, "utf8");
    (status === "created" ? created : updated).push(full);
  }
  // Advertise the escape hatch before anyone needs it. Not a `.sql` file, so the
  // loader and the pruner both ignore it, and it is never an owned file.
  const {
    written: scaffoldedCustomReadme,
    skippedSymlink: customReadmeSkippedSymlink,
  } = scaffoldCustomReadme(outRoot);
  const loadOrder = files.map((file) => file.name.split(sep).join("/"));
  const ownedFiles = [...loadOrder].sort();
  writeExportManifest(outRoot, { ...manifest, files: ownedFiles, loadOrder });
  return {
    removed,
    unmanaged,
    created,
    updated,
    unchanged,
    scaffoldedCustomReadme,
    customReadmeSkippedSymlink,
  };
}

export async function cmdSchemaExport(args: string[]): Promise<void> {
  let parsed;
  try {
    parsed = parseFlags(args, {
      source: { type: "value", required: true },
      "out-dir": { type: "value", required: true },
      layout: { type: "value" },
      "path-style": { type: "value" },
      profile: { type: "value" },
      "strict-coverage": { type: "boolean" },
      "unsafe-show-secrets": { type: "boolean" },
      "grouping-mode": { type: "value" },
      "group-patterns": { type: "value" },
      "flat-schemas": { type: "value" },
      "no-group-partitions": { type: "boolean" },
      "format-options": { type: "value" },
      "no-format": { type: "boolean" },
      scope: { type: "value" },
      "default-owner": { type: "value" },
      "prune-unmanaged": { type: "boolean" },
    });
  } catch (err) {
    if (err instanceof UsageError) {
      throw new UsageError(
        `${err.message}\nUsage: pgdelta schema export --source <pg-url> --out-dir <dir> ` +
          `[--layout by-object|ordered|grouped] [--path-style flat|nested] [--profile ${PROFILE_IDS}] [--strict-coverage] [--unsafe-show-secrets] [--scope database|cluster] [--prune-unmanaged]\n` +
          `  [--path-style flat|nested] (flat, the default: <schema>/tables/t.sql + _cluster/roles.sql; nested: the historical schemas/<schema>/… + cluster/…)\n` +
          `  [--default-owner <role|none>] (which owner stays implicit; default: profile default or the database owner; "none" emits every OWNER TO)\n` +
          `  [--prune-unmanaged] (delete .sql files in --out-dir this export does not own; refuse otherwise)\n` +
          `  [--format-options '{"keywordCase":"upper","maxWidth":180}'] [--no-format]\n` +
          `    (SQL is pretty-printed by default: lowercase keywords, width 180; any layout)\n` +
          `  Grouped-layout options (only with --layout grouped):\n` +
          `    [--grouping-mode single-file|subdirectory] [--group-patterns <json>] [--flat-schemas <csv>] [--no-group-partitions]`,
      );
    }
    throw err;
  }

  const { flags } = parsed;
  const sourceUrl = flags["source"];
  const outDir = flags["out-dir"];
  // Management scope of the export (default database-local). `database` omits
  // cluster-global roles/memberships so the directory reloads on any cluster;
  // `cluster` includes them. Stamped in the manifest so `schema apply` matches.
  let exportScope: ManagementScope = "database";
  const exportScopeFlag = flags["scope"];
  if (exportScopeFlag === "database" || exportScopeFlag === "cluster") {
    exportScope = exportScopeFlag;
  } else if (exportScopeFlag !== undefined) {
    throw new UsageError(
      `--scope must be database or cluster (got: ${exportScopeFlag})`,
    );
  }
  let layout: "by-object" | "ordered" | "grouped" = "by-object";
  if (flags["layout"] !== undefined) {
    const v = flags["layout"];
    if (v !== "by-object" && v !== "ordered" && v !== "grouped") {
      throw new UsageError(
        `--layout must be by-object, ordered, or grouped (got: ${v})`,
      );
    }
    layout = v;
  }
  // Root-segment style, orthogonal to --layout: `flat` (default) puts schema
  // directories at the export root with cluster files under `_cluster/`;
  // `nested` reproduces the historical `schemas/<s>/…` + `cluster/…` tree.
  let pathStyle: ExportPathStyle = "flat";
  if (flags["path-style"] !== undefined) {
    const v = flags["path-style"];
    if (v !== "flat" && v !== "nested") {
      throw new UsageError(`--path-style must be flat or nested (got: ${v})`);
    }
    pathStyle = v;
  }

  // Grouping options apply only to the grouped layout. Parse them up front so
  // a malformed value fails before connecting to the database.
  let grouping: ExportGrouping | undefined;
  if (layout === "grouped") {
    const mode = flags["grouping-mode"];
    if (
      mode !== undefined &&
      mode !== "single-file" &&
      mode !== "subdirectory"
    ) {
      throw new UsageError(
        `--grouping-mode must be single-file or subdirectory (got: ${mode})`,
      );
    }
    let groupPatterns: ExportGroupingPattern[] | undefined;
    if (flags["group-patterns"] !== undefined) {
      try {
        const raw = JSON.parse(flags["group-patterns"]) as unknown;
        if (
          !Array.isArray(raw) ||
          !raw.every(
            (p): p is ExportGroupingPattern =>
              typeof p === "object" &&
              p !== null &&
              typeof (p as { pattern?: unknown }).pattern === "string" &&
              typeof (p as { name?: unknown }).name === "string",
          )
        ) {
          throw new Error("expected an array of { pattern, name } objects");
        }
        groupPatterns = raw;
      } catch (e) {
        throw new UsageError(
          `--group-patterns must be JSON array of { pattern, name }: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    const flatSchemas = flags["flat-schemas"]
      ?.split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "");
    grouping = {
      ...(mode !== undefined ? { mode } : {}),
      ...(groupPatterns !== undefined ? { groupPatterns } : {}),
      ...(flatSchemas !== undefined && flatSchemas.length > 0
        ? { flatSchemas }
        : {}),
      ...(flags["no-group-partitions"] ? { autoGroupPartitions: false } : {}),
    };
  }

  // SQL formatting is ON by default — the export is a human-facing artifact, so
  // it pretty-prints with lowercase keywords and a 180-char width (formatter
  // defaults otherwise: aligned columns). --format-options overrides every
  // knob; --no-format restores the raw renderer output. Layout-agnostic, and
  // purely cosmetic by contract: the fidelity gate (load(export) ≡ fb) covers
  // the formatter. Parsed up front so a malformed value fails before connecting.
  let format: SqlFormatOptions | undefined = flags["no-format"]
    ? undefined
    : { keywordCase: "lower", maxWidth: 180 };
  if (flags["format-options"] !== undefined) {
    if (flags["no-format"]) {
      throw new UsageError(
        "--format-options and --no-format are mutually exclusive",
      );
    }
    try {
      const raw = JSON.parse(flags["format-options"]) as unknown;
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new Error("expected a JSON object");
      }
      format = raw as SqlFormatOptions;
    } catch (e) {
      throw new UsageError(
        `--format-options must be a JSON object (e.g. '{"keywordCase":"upper","maxWidth":180}'): ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  const src = makePool(sourceUrl, { role: "source" });
  try {
    const redactSecrets = !flags["unsafe-show-secrets"];
    const profile = profileById(flags["profile"]);
    process.stderr.write("Extracting...\n");
    const result = await buildSchemaExport(src.pool, {
      profile,
      scope: exportScope,
      redactSecrets,
      layout,
      pathStyle,
      ...(grouping !== undefined ? { grouping } : {}),
      ...(format !== undefined ? { format } : {}),
      ...(flags["default-owner"] === "none"
        ? { defaultOwner: null }
        : flags["default-owner"] !== undefined && flags["default-owner"] !== ""
          ? { defaultOwner: flags["default-owner"] }
          : {}),
      onWarning: (message) => process.stderr.write(`  WARNING: ${message}\n`),
    });
    printDiagnostics(result.diagnostics);
    exitIfBlocking(result.diagnostics, {
      strictCoverage: flags["strict-coverage"],
      action: "export",
    });

    const outRoot = resolve(outDir);
    const {
      removed,
      created,
      updated,
      unchanged,
      scaffoldedCustomReadme,
      customReadmeSkippedSymlink,
    } = writeExportFiles(
      outRoot,
      result.files,
      {
        redactSecrets: result.manifest.redactSecrets,
        scope: result.manifest.scope,
        ...(result.manifest.profile !== undefined
          ? { profile: result.manifest.profile }
          : {}),
        ...(result.manifest.baselineDigest !== undefined
          ? { baselineDigest: result.manifest.baselineDigest }
          : {}),
        ...(result.manifest.scope === "database" &&
        "defaultOwner" in result.manifest
          ? { defaultOwner: result.manifest.defaultOwner }
          : {}),
      },
      flags["prune-unmanaged"] === true,
    );
    if (removed.length > 0) {
      process.stderr.write(
        `Removed ${removed.length} stale .sql file(s) from ${outDir}\n`,
      );
    }
    if (scaffoldedCustomReadme) {
      process.stderr.write(
        `Scaffolded ${CUSTOM_DIR_NAME}/${CUSTOM_README_NAME} — put SQL pg-delta does not model ` +
          `(and idempotent DML) there; it is preserved across exports and loaded into the shadow.\n`,
      );
    }
    if (customReadmeSkippedSymlink) {
      process.stderr.write(
        `custom: ${CUSTOM_DIR_NAME} is a symlink; skipping README scaffold\n`,
      );
    }
    process.stderr.write(
      `Exported ${result.files.length} file(s) to ${outDir} (layout: ${layout}, path style: ${pathStyle}): ` +
        `${created.length} created, ${updated.length} updated, ${unchanged.length} unchanged\n`,
    );
  } finally {
    await src.end();
  }
}

/** Discriminated result of {@link prepareApplyFiles}. */
type PreparedApplyFiles =
  | { ok: true; files: SqlFile[]; skipped: { file: string; stmt: string }[] }
  | { ok: false; message: string };

/**
 * Collect and validate the declarative SQL files for `schema apply`, applying the
 * database-scope cluster-DDL policy. Delegates to {@link prepareSchemaFiles}.
 */
export function prepareApplyFiles(
  dir: string,
  scope: "database" | "cluster",
  skipClusterDdl: boolean,
): PreparedApplyFiles {
  const files = collectSqlFiles(dir);
  const prepared = prepareSchemaFiles(files, {
    scope,
    skipClusterDdl,
    label: dir,
  });
  if (!prepared.ok) {
    let message = prepared.message
      .replace(
        /^scope database does not manage/,
        "--scope database does not manage",
      )
      .replace(
        /Use scope cluster \(with an isolated shadow\) to manage roles, or skipClusterDdl to skip these statements\./,
        "Use --scope cluster (with --isolated-shadow) to manage roles, or --skip-cluster-ddl to skip these statements.",
      )
      .replace(/after skipClusterDdl,/, "after --skip-cluster-ddl,");
    if (
      message.includes("no executable SQL found") &&
      !message.includes("Check the --dir path")
    ) {
      message = `${message} Check the --dir path.`;
    }
    return { ok: false, message };
  }
  return prepared;
}

/** Warn whenever a schema-apply output surface can expose cleartext secrets.
 *  The caller passes the EFFECTIVE redaction mode, already reconciled with the
 *  export manifest, so flag- and manifest-driven unsafe modes cannot drift. */
function warnIfUnredactedOutput(
  redactSecrets: boolean,
  output:
    | "plan artifact"
    | "dry-run script"
    | "verbose output"
    | "planning failure diagnostic"
    | "failure diagnostic",
): void {
  if (!redactSecrets) {
    process.stderr.write(
      `  WARNING: secrets are unredacted (--unsafe-show-secrets or the export manifest) — the ${output} may contain unredacted credentials.\n`,
    );
  }
}

/** True only when a shadow-load failure can surface an authored statement.
 *  Early policy/connection/empty-shadow failures do not carry statement text
 *  and therefore do not need the unredacted-output warning. */
function hasShadowStatementDiagnostic(
  error: unknown,
): error is ShadowLoadError {
  return (
    error instanceof ShadowLoadError &&
    error.details.some(
      (detail) =>
        detail.code === "stuck_statement" ||
        detail.code === "max_rounds_exceeded",
    )
  );
}

export async function cmdSchemaApply(args: string[]): Promise<void> {
  let parsed;
  try {
    parsed = parseFlags(args, {
      dir: { type: "value", required: true },
      shadow: { type: "value" },
      target: { type: "value", required: true },
      renames: { type: "value" },
      force: { type: "boolean" },
      "accept-rename": { type: "multi" },
      profile: { type: "value" },
      "restrict-to-applier": { type: "boolean" },
      "strict-coverage": { type: "boolean" },
      "strict-function-bodies": { type: "boolean" },
      "strict-data-statements": { type: "boolean" },
      "no-reorder": { type: "boolean" },
      "unsafe-show-secrets": { type: "boolean" },
      "isolated-shadow": { type: "boolean" },
      scope: { type: "value" },
      "skip-cluster-ddl": { type: "boolean" },
      "keep-shadow": { type: "boolean" },
      "dry-run": { type: "boolean" },
      verbose: { type: "boolean" },
      "out-plan": { type: "value" },
      "allow-data-loss": { type: "boolean" },
      "trusted-local-host": { type: "multi" },
      "allow-remote-shadow": { type: "boolean" },
      "allow-same-database-identity": { type: "boolean" },
    });
  } catch (err) {
    if (err instanceof UsageError) {
      throw new UsageError(
        `${err.message}\nUsage: pgdelta schema apply --dir <dir> --target <pg-url> [--shadow <pg-url>] ` +
          `[--renames auto|prompt|off] [--force] [--accept-rename <from>=<to>] ... ` +
          `[--profile ${PROFILE_IDS}] [--restrict-to-applier] [--strict-coverage] [--strict-function-bodies] [--strict-data-statements] [--no-reorder] [--unsafe-show-secrets] [--isolated-shadow] [--scope database|cluster] [--skip-cluster-ddl] [--keep-shadow] [--allow-data-loss] ` +
          `[--trusted-local-host <hostname>]... [--allow-remote-shadow] [--allow-same-database-identity]\n` +
          `  [--dry-run] (print the portable apply script to stdout; apply nothing; see pgdelta --help for execution requirements) [--verbose] (stream per-statement progress to stderr) [--out-plan <plan.json>] (write the plan artifact)\n` +
          `  --shadow omitted: a co-located shadow database is created on the target's cluster (database scope only) and dropped after.`,
      );
    }
    throw err;
  }

  const { flags } = parsed;
  const dir = flags["dir"];
  const shadowFlag = flags["shadow"];
  const targetUrl = flags["target"];
  const force = flags["force"];
  const acceptRenameRaw = flags["accept-rename"];
  const dryRun = flags["dry-run"];
  const verbose = flags["verbose"];
  const outPlanPath = flags["out-plan"];

  // The export directory's manifest (redaction mode, profile, scope), consulted
  // once and reused. Absent for hand-authored dirs / older exports.
  const manifest = readExportManifest(dir);

  // Management scope (declarative default: database-local). `cluster` scope
  // manages roles/memberships/ownership and therefore REQUIRES an isolated
  // shadow — loading cluster-global role DDL onto a shared shadow cluster would
  // mutate roles other databases use. `database` scope treats roles as ambient
  // (assumed to exist at apply time) and never diffs them (§scope). Prefer the
  // flag, else the manifest's scope, else database; reject a flag that
  // contradicts the manifest (mirrors the profile reconciliation).
  const scopeFlag = flags["scope"];
  if (
    scopeFlag !== undefined &&
    scopeFlag !== "database" &&
    scopeFlag !== "cluster"
  ) {
    throw new UsageError(
      `--scope must be database or cluster (got: ${scopeFlag})`,
    );
  }
  if (
    (scopeFlag === "database" || scopeFlag === "cluster") &&
    manifest?.scope !== undefined &&
    scopeFlag !== manifest.scope
  ) {
    throw new UsageError(
      `--scope ${scopeFlag} contradicts the export manifest scope (${manifest.scope}); re-export or drop --scope.`,
    );
  }
  let scope: ManagementScope = "database";
  if (scopeFlag === "database" || scopeFlag === "cluster") {
    scope = scopeFlag;
  } else if (manifest?.scope !== undefined) {
    scope = manifest.scope;
  }
  if (scope === "cluster" && !flags["isolated-shadow"]) {
    throw new UsageError(
      `--scope cluster manages cluster-global roles and must run against a dedicated shadow cluster; pass --isolated-shadow.`,
    );
  }
  if (flags["isolated-shadow"] && shadowFlag === undefined) {
    throw new UsageError(
      `--isolated-shadow requires an explicit --shadow; omit --isolated-shadow to use the co-located database-scope shadow.`,
    );
  }

  // --renames default for CLI is "prompt"
  let renames: RenameMode = "prompt";
  if (flags["renames"] !== undefined) {
    const v = flags["renames"];
    if (v !== "auto" && v !== "prompt" && v !== "off") {
      throw new UsageError(
        `--renames must be auto, prompt, or off (got: ${v})`,
      );
    }
    renames = v;
  }

  // parse --accept-rename <from>=<to> entries
  const acceptRenames: Array<{ from: StableId; to: StableId }> = [];
  for (const entry of acceptRenameRaw) {
    const eqIdx = entry.indexOf("=");
    if (eqIdx === -1) {
      throw new UsageError(
        `--accept-rename value must be in <from>=<to> form (got: ${entry})`,
      );
    }
    const fromStr = entry.slice(0, eqIdx);
    const toStr = entry.slice(eqIdx + 1);
    try {
      acceptRenames.push({ from: parseId(fromStr), to: parseId(toStr) });
    } catch (e) {
      throw new UsageError(
        `--accept-rename: invalid stable-id in "${entry}": ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // Collect + validate the declarative SQL files: refuse an empty/comment-only
  // dir (would build an empty shadow and drop every managed object), and enforce
  // the database-scope cluster-DDL policy (refuse, or --skip-cluster-ddl and log
  // each skip). Extracted to prepareApplyFiles so the guards — including the
  // re-check that a --skip-cluster-ddl strip did not empty the input — are unit
  // tested.
  const prepared = prepareApplyFiles(
    dir,
    scope,
    flags["skip-cluster-ddl"] === true,
  );
  if (!prepared.ok) {
    throw new UsageError(`schema apply: ${prepared.message}`);
  }
  for (const s of prepared.skipped) {
    process.stderr.write(
      `  SKIP cluster DDL (--skip-cluster-ddl) in ${s.file}: ${s.stmt}\n`,
    );
  }
  let files = prepared.files;

  // The profile MUST match the one the directory was exported with: `schema
  // export --profile supabase` projects out platform schemas/roles, so applying
  // that directory under the default (raw) profile would extract the target's
  // platform state as drift and plan destructive drops. Default to the profile
  // stamped in the export manifest and reject a contradicting --profile before
  // opening any connection, exactly as `apply`/`prove` reconcile plan artifacts
  // (review P1).
  const manifestProfile = manifest?.profile;
  // effectiveProfileId throws UsageError on a --profile that contradicts the
  // manifest; it propagates to main() (→ message + exit 2).
  const profileId: string | undefined = effectiveProfileId(
    flags["profile"],
    manifestProfile,
  );

  // Resolve the shadow: an explicit --shadow, else a co-located throwaway
  // database created on the TARGET's own cluster (quick mode). Co-located is
  // database scope only — it shares the target's cluster, so it must never carry
  // cluster-global role DDL. The created database is dropped in the finally.
  let coLocated: CoLocatedShadow | undefined;
  let shadowUrl: string;
  if (shadowFlag !== undefined) {
    let shadowIsLocal: boolean;
    try {
      if (
        connectionEndpointHash(shadowFlag) === connectionEndpointHash(targetUrl)
      ) {
        throw new UsageError(
          "schema apply: --shadow resolves to the target endpoint; refusing to load declarative SQL into the target database",
        );
      }
      shadowIsLocal = isTrustedLocalConnection(
        shadowFlag,
        flags["trusted-local-host"],
      );
    } catch (error) {
      if (error instanceof UsageError) throw error;
      throw new UsageError(
        `schema apply: invalid shadow endpoint safety option — ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!shadowIsLocal && !flags["allow-remote-shadow"]) {
      throw new UsageError(
        "schema apply: an explicit --shadow must use localhost, a loopback address, a Unix socket, or an exact --trusted-local-host; pass --allow-remote-shadow only for an intentional remote shadow",
      );
    }
    shadowUrl = shadowFlag;
  } else {
    if (scope === "cluster") {
      throw new UsageError(
        `schema apply --scope cluster needs an explicit --shadow to a dedicated cluster; a co-located shadow (no --shadow) is database scope only.`,
      );
    }
    process.stderr.write(
      `No --shadow given; creating a co-located shadow database on the target's cluster...\n`,
    );
    try {
      coLocated = await provisionCoLocatedShadow(targetUrl, {
        keep: flags["keep-shadow"],
      });
    } catch (e) {
      if (isShadowProvisionError(e)) {
        // Operational failure (couldn't create the shadow DB): keep the exit-2
        // channel. No pools exist yet, so nothing to release.
        process.stderr.write(`schema apply: ${e.message}\n`);
        throw new CliExit(2);
      }
      throw e;
    }
    shadowUrl = coLocated.url;
    process.stderr.write(`  Created shadow database ${coLocated.name}\n`);
  }

  const shadow = makePool(shadowUrl);
  const tgt = makePool(targetUrl);
  // Close the pools and drop the co-located throwaway database. Called by the
  // `finally` below, which always runs — the early-exit paths inside the try now
  // THROW (CliExit / SchemaFrontendError / UsageError) instead of calling
  // process.exit, so cleanup happens on every exit and the co-located shadow is
  // never leaked (`--keep-shadow` keeps it).
  const releaseResources = async (): Promise<void> => {
    await Promise.all([shadow.end(), tgt.end()]);
    if (coLocated !== undefined) {
      if (flags["keep-shadow"]) {
        process.stderr.write(`  Kept shadow database ${coLocated.name}\n`);
      }
      await coLocated.cleanup();
    }
  };
  try {
    if (shadowFlag !== undefined) {
      const { targetIdentity, shadowIdentity } =
        await observeExplicitShadowIdentities(tgt.pool, shadow.pool);
      const sameDatabaseIdentity = isSameDatabase(
        targetIdentity,
        shadowIdentity,
      );
      if (sameDatabaseIdentity && !flags["allow-same-database-identity"]) {
        throw new UsageError(
          `schema apply: shadow and target are the same observed database (${targetIdentity.database}); refusing to load declarative SQL. ` +
            `A physically cloned shadow (e.g. a warm shadow cache restored from a PGDATA snapshot of the target cluster) inherits the ` +
            `target's system identifier and database OIDs and reports as the same database here; if the shadow is known to be a separate ` +
            `server, pass --allow-same-database-identity to bypass this check`,
        );
      }
      // The flag attests "my shadow is a physical clone of the target" — it exempts
      // lineage containment ONLY for that exact-identity match, never for a
      // same-lineage sibling database (same system identifier, different database
      // OID), which is a genuinely different database on the same cluster and must
      // still be refused.
      const trustedCloneBypass =
        flags["allow-same-database-identity"] === true && sameDatabaseIdentity;
      if (
        scope === "cluster" &&
        isSamePostgresLineage(targetIdentity, shadowIdentity) &&
        !trustedCloneBypass
      ) {
        throw new UsageError(
          "schema apply: --scope cluster requires a shadow from a different PostgreSQL lineage; the supplied shadow shares the target lineage " +
            "(same-lineage sibling databases are not covered by --allow-same-database-identity)",
        );
      }
      if (
        flags["isolated-shadow"] &&
        isSamePostgresLineage(targetIdentity, shadowIdentity) &&
        !trustedCloneBypass
      ) {
        throw new UsageError(
          "schema apply: an isolated shadow (--isolated-shadow) requires a different PostgreSQL lineage; the supplied shadow shares the target lineage " +
            "(same-lineage sibling databases are not covered by --allow-same-database-identity)",
        );
      }
    }
    const redactSecrets =
      manifest?.redactSecrets ?? !flags["unsafe-show-secrets"];
    const profile = profileById(profileId);

    // Hand-authored / pre-feature dirs: surface the same NOTE the old path did.
    if (
      scope === "database" &&
      (manifest === undefined || !("defaultOwner" in manifest))
    ) {
      process.stderr.write(
        `  NOTE: the directory records no default owner, so it is applied verbose ` +
          `(all ownership honored as written). Re-export with the current pg-delta to ` +
          `record a default owner.\n`,
      );
    }

    process.stderr.write("Extracting target / loading shadow...\n");
    // planSchemaFiles throws SchemaFrontendError (baseline mismatch, cron
    // precheck, …) / UsageError; both propagate to main() (→ message + exit 2).
    // A ShadowLoadError propagates too (main's generic path → details + exit 1).
    // The finally below still runs, dropping any co-located shadow.
    const planned = await planSchemaFiles(tgt.pool, shadow.pool, files, {
      profile,
      scope,
      ...(manifest !== undefined ? { manifest } : {}),
      redactSecrets,
      skipClusterDdl: flags["skip-cluster-ddl"] === true,
      isolatedShadow: flags["isolated-shadow"] === true,
      // Threaded through so the library guard does not re-refuse what the CLI
      // guard was told to allow; the bypass WARNING is emitted there (onWarning
      // below prints it) rather than twice from both layers.
      allowSameDatabaseIdentity: flags["allow-same-database-identity"] === true,
      seedAssumedSchemas: coLocated !== undefined,
      renames,
      ...(acceptRenames.length > 0 ? { acceptRenames } : {}),
      resolveOptions: {
        restrictToApplier: flags["restrict-to-applier"],
      },
      strictFunctionBodies: flags["strict-function-bodies"] === true,
      strictDataStatements: flags["strict-data-statements"] === true,
      reorder: !flags["no-reorder"],
      onWarning: (message) => {
        if (message.startsWith("the directory records no default owner")) {
          // already printed above for CLI parity
          return;
        }
        process.stderr.write(`  WARNING: ${message}\n`);
      },
      onShadowLoadError: (error, ctx) => {
        let enriched = rewriteReorderedShadowError(
          error,
          ctx.orderedFiles!,
          ctx.originalSqlByName,
        );
        const nonConverging = error.details.some(
          (d) =>
            d.code === "stuck_statement" || d.code === "max_rounds_exceeded",
        );
        if (nonConverging) {
          enriched = appendShadowCycleHint(
            enriched,
            ctx.cycles,
            ctx.originalSqlByName,
          );
        }
        return enriched;
      },
    }).catch((error: unknown) => {
      if (hasShadowStatementDiagnostic(error)) {
        warnIfUnredactedOutput(redactSecrets, "planning failure diagnostic");
      }
      throw error;
    });

    printDiagnostics(planned.loadDiagnostics, { label: "shadow" });
    printDiagnostics(planned.targetDiagnostics, { label: "target" });
    // `unmodeled_drift` is neither side's extraction output but a comparison of
    // the two, so it gets its own label — and it gates like the other coverage
    // gaps under --strict-coverage.
    printDiagnostics(planned.driftDiagnostics, { label: "drift" });
    printDiagnostics(planned.plan.diagnostics ?? [], { label: "plan" });
    exitIfBlocking(
      [
        ...planned.loadDiagnostics,
        ...planned.targetDiagnostics,
        ...planned.driftDiagnostics,
        ...(planned.plan.diagnostics ?? []),
      ],
      {
        strictCoverage: flags["strict-coverage"],
        action: "apply",
      },
    );

    const thePlan = planned.plan;
    process.stderr.write(`Planning: ${thePlan.actions.length} action(s)\n`);

    if (renames === "prompt" && thePlan.renameCandidates.length > 0) {
      process.stderr.write(`\nRename candidates:\n`);
      for (const c of thePlan.renameCandidates) {
        const fromStr = encodeId(c.from);
        const toStr = encodeId(c.to);
        if (c.status === "unambiguous") {
          process.stderr.write(
            `  ? Rename ${fromStr} -> ${toStr}? (${c.status})\n`,
          );
          process.stderr.write(
            `    To confirm, rerun with: --accept-rename ${fromStr}=${toStr}\n`,
          );
        } else {
          process.stderr.write(
            `  ${c.status}: ${fromStr} -> ${toStr}${c.reason ? ` (${c.reason})` : ""}\n`,
          );
        }
      }
      process.stderr.write("\n");
    }

    // --out-plan: archive the plan artifact right after planning, regardless
    // of whether the run goes on to --dry-run's script or a real apply.
    if (outPlanPath !== undefined) {
      warnIfUnredactedOutput(redactSecrets, "plan artifact");
      writeFileSync(outPlanPath, serializePlan(thePlan), "utf8");
      process.stderr.write(`Plan artifact written to ${outPlanPath}\n`);
    }

    if (thePlan.actions.length === 0) {
      process.stderr.write("Target is already up to date.\n");
      return;
    }

    if (dryRun) {
      const script = renderApplyScript(thePlan, {
        ...(planned.applyOptions.lockTimeoutMs !== undefined
          ? { lockTimeoutMs: planned.applyOptions.lockTimeoutMs }
          : {}),
        ...(planned.applyOptions.statementTimeoutMs !== undefined
          ? { statementTimeoutMs: planned.applyOptions.statementTimeoutMs }
          : {}),
      });
      // The script is routinely redirected to a file, making it as persistent
      // as an archived plan artifact. Warn before stdout can expose it.
      warnIfUnredactedOutput(redactSecrets, "dry-run script");
      process.stdout.write(script);
      process.stderr.write(
        `Dry run: ${thePlan.actions.length} action(s) planned; nothing applied.\n`,
      );
      const destructiveCount =
        thePlan.actions.filter(isDestructiveAction).length;
      if (destructiveCount > 0) {
        process.stderr.write(
          `WARNING: plan contains ${destructiveCount} destructive action(s).\n`,
        );
      }
      return;
    }

    const destructive = assertDataLossAllowed(
      thePlan.actions,
      flags["allow-data-loss"],
      "schema apply",
    );
    if (destructive.length > 0) {
      process.stderr.write(
        "WARNING: --allow-data-loss permits actions that can permanently destroy data.\n",
      );
    }

    // A real verbose apply writes every action SQL to stderr. Warn after the
    // dry-run early return (where --verbose has no effect) and before the first
    // action can expose a credential.
    if (verbose) {
      warnIfUnredactedOutput(redactSecrets, "verbose output");
    }

    if (force) {
      process.stderr.write("WARNING: --force disables the fingerprint gate.\n");
    }

    // --verbose: stream per-segment/per-action progress to stderr as apply()
    // executes. Purely additive (apply.ts's `onEvent` is guarded against a
    // throwing observer) — never changes what gets applied or the report.
    // `segmentEnd` doesn't carry the segment count, so remember it from the
    // most recent `segmentStart` (events for one apply() call arrive in order).
    let lastSegmentCount = 1;
    const onEvent = verbose
      ? (event: ApplyEvent): void => {
          switch (event.kind) {
            case "segmentStart":
              lastSegmentCount = event.segmentCount;
              process.stderr.write(
                `-- segment ${event.segmentIndex + 1}/${event.segmentCount} (${
                  event.transactional ? "transactional" : "non-transactional"
                }), ${event.end - event.start} action(s)\n`,
              );
              break;
            case "actionStart":
              process.stderr.write(
                `[${event.actionIndex + 1}/${thePlan.actions.length}] ${event.sql}\n`,
              );
              break;
            case "actionEnd":
              process.stderr.write(
                `[${event.actionIndex + 1}/${thePlan.actions.length}] ${
                  event.ok ? `ok (${event.ms}ms)` : `FAILED (${event.ms}ms)`
                }\n`,
              );
              break;
            case "segmentEnd":
              process.stderr.write(
                `-- segment ${event.segmentIndex + 1}/${lastSegmentCount} ${event.outcome}\n`,
              );
              break;
            case "control":
              // every OTHER statement apply() sends on the wire — BEGIN,
              // preamble SET/SET LOCAL, COMMIT, ROLLBACK, RESET ALL — prefixed
              // to stay visually distinct from `[i/total] <action sql>` lines.
              process.stderr.write(`  ; ${event.sql}\n`);
              break;
          }
        }
      : undefined;

    const report = await apply(thePlan, tgt.pool, {
      ...planned.applyOptions,
      reextract: (p) =>
        planned.extract(p, { redactSecrets: planned.redactSecrets }),
      fingerprintGate: !force,
      ...(onEvent !== undefined ? { onEvent } : {}),
    });

    if (report.status === "applied") {
      process.stderr.write(
        `Applied ${report.appliedActions} action(s) successfully.\n`,
      );
    } else {
      process.stderr.write("Apply failed!\n");
      if (report.error) {
        // Non-verbose applies have not exposed action SQL yet. PostgreSQL's
        // error message can echo that SQL, so warn before the entire failure
        // diagnostic. Verbose mode already warned before its actionStart trace.
        if (!verbose) {
          warnIfUnredactedOutput(redactSecrets, "failure diagnostic");
        }
        const subject =
          (report.error.statementKind ?? "action") === "action"
            ? `action[${report.error.actionIndex}]`
            : "control";
        process.stderr.write(`  ${subject}: ${report.error.message}\n`);
        process.stderr.write(`  sql: ${report.error.sql}\n`);
      }
      // The finally below releases resources (drops any co-located shadow);
      // main() maps CliExit(1) → exit 1 with no extra banner.
      throw new CliExit(1);
    }
  } finally {
    // drop the co-located throwaway database (after our pools close so nothing
    // holds a connection to it); --keep-shadow makes cleanup a no-op.
    await releaseResources();
  }
}

export async function cmdSchemaLint(args: string[]): Promise<void> {
  let parsed;
  try {
    parsed = parseFlags(args, {
      dir: { type: "value", required: true },
      "custom-migration-refs": { type: "value" },
    });
  } catch (err) {
    if (err instanceof UsageError) {
      throw new UsageError(
        `${err.message}\nUsage: pgdelta schema lint --dir <dir> ` +
          `[--custom-migration-refs warn|off]`,
      );
    }
    throw err;
  }

  const { flags } = parsed;
  const dir = flags["dir"];
  const missingRefMode = flags["custom-migration-refs"] ?? "warn";
  if (missingRefMode !== "warn" && missingRefMode !== "off") {
    throw new UsageError(
      `--custom-migration-refs must be warn or off (got: ${missingRefMode})`,
    );
  }
  const files = collectSqlFiles(dir);
  if (files.length === 0) {
    process.stderr.write(`No .sql files found in ${dir}.\n`);
    return;
  }

  const originalSqlByName = new Map(files.map((f) => [f.name, f.sql]));
  const emit = (
    lines: readonly string[],
    errorCount: number,
    warningCount: number,
  ): void => {
    process.stderr.write(`Linted ${files.length} file(s) in ${dir}.\n`);
    for (const line of lines) {
      process.stderr.write(`  ${line}\n`);
    }
    if (lines.length === 0) {
      process.stderr.write("No issues found.\n");
    } else {
      process.stderr.write(
        `\n${errorCount} error(s), ${warningCount} warning(s).\n`,
      );
    }
  };
  const render = (finding: CustomLintFinding): string => {
    const location =
      finding.location !== undefined
        ? formatStatementLocation(
            finding.location,
            originalSqlByName.get(finding.location.filePath),
          )
        : finding.file;
    return `WARNING [${finding.code}] ${location}: ${finding.message}`;
  };

  // The `_custom/` bookkeeping rules (docs/architecture/custom-folder.md §4) are
  // lint-only warnings and never blocking. The directive rules are pure fs work,
  // so they run BEFORE the pg-topo analysis — an absent optional peer must not
  // swallow findings that never needed it.
  const customFindings = lintCustomMigrationRefs(dir, files, {
    missingRef: missingRefMode,
  });

  // Pure static analysis — no shadow/target database. Surfaces pg-topo
  // diagnostics (cycles, unknown statements, duplicate producers, …) for
  // proactive authoring; deliberately kept OUT of the apply path so apply stays
  // Postgres-truth. Throws ReorderUnavailableError (with an install hint) when
  // @supabase/pg-topo is absent.
  let analyzed;
  try {
    analyzed = await analyzeForShadow(files);
  } catch (error) {
    // Report what we already know, then let the install hint propagate.
    if (customFindings.length > 0) {
      emit(customFindings.map(render), 0, customFindings.length);
    }
    throw error;
  }
  customFindings.push(...lintCustomModeledKinds(analyzed.files));
  const report = formatLintReport(
    { cycles: analyzed.cycles, diagnostics: analyzed.diagnostics },
    originalSqlByName,
  );

  emit(
    [...report.lines, ...customFindings.map(render)],
    report.errorCount,
    report.warningCount + customFindings.length,
  );
  if (report.blocking) {
    throw new CliExit(1);
  }
}
