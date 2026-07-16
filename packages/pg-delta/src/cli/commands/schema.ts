/**
 * schema export --source <pg-url> --out-dir <dir> [--layout by-object|ordered|grouped]
 *   Export the source database as SQL files written to disk.
 *   Maps to old `declarative-export`.
 *
 *   Layouts:
 *     by-object (default) — the familiar tree (schemas/<s>/tables/<t>.sql, …),
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
 * schema apply --dir <dir> --shadow <pg-url> --target <pg-url>
 *              [--renames auto|prompt|off] [--force]
 *              [--accept-rename <from>=<to>] (repeatable) [--no-reorder]
 *   Read .sql files recursively (lexicographic), load into shadow, extract
 *   target, plan, apply.  Maps to old `declarative-apply` / `sync`.
 *
 *   By default the SQL files are passed through the statement-reordering assist
 *   (target-architecture §4.4.1): each file is split into one-statement units
 *   and topologically pre-sorted before loading, so authoring order within a
 *   file no longer matters and the shadow loader converges in fewer rounds. The
 *   assist is advisory — Postgres still elaborates the shadow — so it can only
 *   fail to BUILD the shadow (a visible error), never corrupt the desired state.
 *
 *   --no-reorder
 *     Skip the reordering assist and load the raw files at file granularity
 *     (the original behavior). Useful for debugging a stuck load.
 *
 *   --accept-rename <from>=<to>
 *     Confirm one rename candidate by the encoded stable-ids shown in a prior
 *     --renames prompt run.  Repeatable; each flag names one confirmed rename.
 */
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, dirname, relative, resolve, sep } from "node:path";
import {
  exportSqlFiles,
  type ExportGrouping,
  type ExportGroupingPattern,
} from "../../frontends/export-sql-files.ts";
import type { SqlFormatOptions } from "../../frontends/sql-format/index.ts";
import { scanTokens } from "../../frontends/sql-format/tokenizer.ts";
import { pruneStaleSqlFiles } from "../../frontends/prune-sql-files.ts";
import { deriveAssumedSchemaSeed } from "../../frontends/seed-assumed-schemas.ts";
import {
  readExportManifest,
  writeExportManifest,
} from "../../frontends/export-manifest.ts";
import {
  findClusterDdlStatements,
  findDefaultPrivilegeStatements,
  findMatchingStatements,
  findSessionSettingStatements,
  loadSqlFiles,
  ShadowLoadError,
  stripClusterDdl,
} from "../../frontends/load-sql-files.ts";
import {
  analyzeForShadow,
  ReorderUnavailableError,
  type OrderedSqlFile,
  type ShadowLoadCycle,
} from "../../frontends/sql-order.ts";
import {
  appendShadowCycleHint,
  formatLintReport,
  rewriteReorderedShadowError,
} from "../reorder-display.ts";
import { plan } from "../../plan/plan.ts";
import { flattenPolicy, resolveView } from "../../policy/policy.ts";
import {
  type ManagementScope,
  projectManagementScope,
} from "../../policy/view.ts";
import { apply } from "../../apply/apply.ts";
import { encodeId, parseId, type StableId } from "../../core/stable-id.ts";
import { exitIfBlocking, printDiagnostics } from "../diagnostics.ts";
import { makePool } from "../pool.ts";
import {
  type CoLocatedShadow,
  isShadowProvisionError,
  provisionCoLocatedShadow,
} from "../shadow.ts";
import { parseFlags, UsageError } from "../flags.ts";
import {
  effectiveProfileId,
  PROFILE_IDS,
  reconcileBaselineDigest,
  resolveCliProfile,
} from "../profile.ts";
import type { RenameMode } from "../../plan/renames.ts";
import type { SqlFile } from "../../frontends/load-sql-files.ts";

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
 * `outRoot`, returning the stale files pruned. Exported for tests.
 *
 * Creates `outRoot` up front: a database with no managed objects legitimately
 * yields zero files, and the per-file loop (which only mkdirs each file's parent)
 * would then never create the root, so the manifest write would ENOENT (review
 * P2). Stale `.sql` files from a previous export are pruned first so a dropped
 * object's file can't linger and be reloaded (only `.sql` not in the new set;
 * non-SQL untouched).
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
): string[] {
  mkdirSync(outRoot, { recursive: true });
  const keep = new Set(files.map((file) => join(outRoot, file.name)));
  const removed = pruneStaleSqlFiles(outRoot, keep);
  for (const file of files) {
    const full = join(outRoot, file.name);
    // defense-in-depth (review P2): even with per-segment encoding in
    // exportSqlFiles, never let a database identifier escape the output dir.
    if (full !== outRoot && !full.startsWith(outRoot + sep)) {
      throw new Error(
        `export: refusing to write outside ${outRoot}: ${file.name}`,
      );
    }
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, file.sql, "utf8");
  }
  writeExportManifest(outRoot, manifest);
  return removed;
}

export async function cmdSchemaExport(args: string[]): Promise<void> {
  let parsed;
  try {
    parsed = parseFlags(args, {
      source: { type: "value", required: true },
      "out-dir": { type: "value", required: true },
      layout: { type: "value" },
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
    });
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(
        `${err.message}\nUsage: pgdelta schema export --source <pg-url> --out-dir <dir> ` +
          `[--layout by-object|ordered|grouped] [--profile ${PROFILE_IDS}] [--strict-coverage] [--unsafe-show-secrets] [--scope database|cluster]\n` +
          `  [--default-owner <role|none>] (which owner stays implicit; default: profile default or the database owner; "none" emits every OWNER TO)\n` +
          `  [--format-options '{"keywordCase":"upper","maxWidth":180}'] [--no-format]\n` +
          `    (SQL is pretty-printed by default: lowercase keywords, width 180; any layout)\n` +
          `  Grouped-layout options (only with --layout grouped):\n` +
          `    [--grouping-mode single-file|subdirectory] [--group-patterns <json>] [--flat-schemas <csv>] [--no-group-partitions]\n`,
      );
      process.exit(2);
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
    process.stderr.write(
      `--scope must be database or cluster (got: ${exportScopeFlag})\n`,
    );
    process.exit(2);
  }
  let layout: "by-object" | "ordered" | "grouped" = "by-object";
  if (flags["layout"] !== undefined) {
    const v = flags["layout"];
    if (v !== "by-object" && v !== "ordered" && v !== "grouped") {
      process.stderr.write(
        `--layout must be by-object, ordered, or grouped (got: ${v})\n`,
      );
      process.exit(2);
    }
    layout = v;
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
      process.stderr.write(
        `--grouping-mode must be single-file or subdirectory (got: ${mode})\n`,
      );
      process.exit(2);
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
        process.stderr.write(
          `--group-patterns must be JSON array of { pattern, name }: ${e instanceof Error ? e.message : String(e)}\n`,
        );
        process.exit(2);
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
      process.stderr.write(
        "--format-options and --no-format are mutually exclusive\n",
      );
      process.exit(2);
    }
    try {
      const raw = JSON.parse(flags["format-options"]) as unknown;
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new Error("expected a JSON object");
      }
      format = raw as SqlFormatOptions;
    } catch (e) {
      process.stderr.write(
        `--format-options must be a JSON object (e.g. '{"keywordCase":"upper","maxWidth":180}'): ${e instanceof Error ? e.message : String(e)}\n`,
      );
      process.exit(2);
    }
  }

  const src = makePool(sourceUrl);
  try {
    const redactSecrets = !flags["unsafe-show-secrets"];
    // resolve the profile against the source pool so export sees the SAME
    // handler-aware managed view as the profile-aware DB-to-DB path (review P1).
    // redactSecrets is passed so a profile-declared baseline captured in the
    // other mode is rejected rather than silently not subtracting.
    const ctx = await resolveCliProfile(src.pool, flags["profile"], {
      redactSecrets,
    });
    process.stderr.write("Extracting...\n");
    const { factBase, diagnostics } = await ctx.extract(src.pool, {
      redactSecrets,
    });
    printDiagnostics(diagnostics);
    exitIfBlocking(diagnostics, {
      strictCoverage: flags["strict-coverage"],
      action: "export",
    });
    // Export the MANAGED VIEW, not the raw extraction: with a profile
    // (policy/capability/baseline) the exported files must match what
    // `plan --profile` diffs, or policy-hidden schemas/roles and baseline
    // objects would be written into the declarative source and then reappear
    // as drift on `schema apply` (Codex review). For `raw` (no policy) this is
    // an identity projection.
    const view = resolveView(
      factBase,
      ctx.planOptions.policy,
      ctx.planOptions.capability,
      ctx.planOptions.baseline,
    );
    // The view is already policy/capability/baseline-resolved, but it can keep
    // actions that consume assumed-but-filtered objects (a relocatable extension
    // in `extensions`, a GRANT to `anon`). Forward the profile's assumed
    // schema/role sets so the export plan's requirement guard exempts them
    // exactly like the DB-to-DB `plan --profile` path (review P1).
    const assumed = ctx.planOptions.policy
      ? flattenPolicy(ctx.planOptions.policy)
      : undefined;
    // Database scope: drop cluster-global role/membership facts (and their owner
    // edges) from the exported view, so no `cluster/roles.sql` is written and the
    // directory reloads on any cluster. The projected-out roles become ambient,
    // so a `GRANT … TO <role>` the export still emits must be assumed present, or
    // the from-pristine export plan would fail its requirement guard. Enumerate
    // the assumed roles from the PRE-baseline extraction (`factBase`), not the
    // subtracted `view`: a role subtracted as baseline-identical (a platform role)
    // still exists at apply time and is still referenced by a surviving object's
    // owner/REVOKE, so it must stay assumed — otherwise a profile-declared
    // baseline breaks the export's requirement guard (same pre-subtraction rule as
    // the assumed-schema seed).
    // Resolve the DEFAULT OWNER whose ownership stays implicit in a database-scope
    // export (no `ALTER … OWNER TO`): `--default-owner <role|none>` beats the
    // profile-declared default, which beats the database owner (`datdba`). `none`
    // is verbose (every owner serializes) and stamps a `null` manifest. `datdba`
    // is queried at export time and never enters the fact model (it is
    // export-command metadata). Only meaningful under database scope.
    let resolvedDefaultOwner: string | null = null; // null ⇒ verbose / not applicable
    if (exportScope === "database") {
      const ownerFlag = flags["default-owner"];
      if (ownerFlag === "none") {
        resolvedDefaultOwner = null;
      } else if (ownerFlag !== undefined && ownerFlag !== "") {
        resolvedDefaultOwner = ownerFlag;
      } else {
        const profileDefault = assumed?.defaultOwner;
        if (profileDefault !== undefined) {
          resolvedDefaultOwner = profileDefault;
        } else {
          const r = await src.pool.query<{ owner: string }>(
            `SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = current_database()`,
          );
          resolvedDefaultOwner = r.rows[0]?.owner ?? null;
        }
      }
      // Warn when the resolved default owner differs from the export connection
      // role: objects it owns will have OWNER TO suppressed, so applying the dir
      // as anyone else re-introduces ownership drift (and `schema apply` guards
      // against it). Point at `--default-owner` to override.
      if (resolvedDefaultOwner !== null) {
        const cu = (
          await src.pool.query<{ u: string }>(`SELECT current_user AS u`)
        ).rows[0]?.u;
        if (cu !== undefined && cu !== resolvedDefaultOwner) {
          process.stderr.write(
            `  WARNING: the resolved default owner "${resolvedDefaultOwner}" differs from the export ` +
              `connection role "${cu}"; ownership of its objects will be left implicit (no OWNER TO). ` +
              `Apply this directory connecting as "${resolvedDefaultOwner}", or re-export with ` +
              `--default-owner "${cu}" / --default-owner none.\n`,
          );
        }
      }
    }
    const scopedView = projectManagementScope(
      view,
      exportScope,
      resolvedDefaultOwner !== null
        ? { defaultOwner: resolvedDefaultOwner }
        : {},
    );
    const scopeAssumedRoles =
      exportScope === "database"
        ? factBase
            .facts()
            .filter((f) => f.id.kind === "role")
            .map((f) => (f.id as { name: string }).name)
        : [];
    const assumedSchemas = assumed?.assumedSchemas ?? [];
    const assumedRoles = [
      ...(assumed?.assumedRoles ?? []),
      ...scopeAssumedRoles,
    ];
    const files = exportSqlFiles(scopedView, {
      layout,
      ...(grouping !== undefined ? { grouping } : {}),
      ...(format !== undefined ? { format } : {}),
      ...(assumedSchemas.length > 0 ? { assumedSchemas } : {}),
      ...(assumedRoles.length > 0 ? { assumedRoles } : {}),
      // forward the profile's intent rules (e.g. pg_cron under --profile
      // supabase) so a named cron job in the view renders as intent instead of
      // throwing "no intent rule registered" (the from-pristine plan sees it).
      ...(ctx.planOptions.intentRules !== undefined
        ? { intentRules: ctx.planOptions.intentRules }
        : {}),
      onWarning: (message) => process.stderr.write(`  WARNING: ${message}\n`),
    });

    const outRoot = resolve(outDir);
    // Record the redaction mode AND the projection profile so `schema apply
    // --dir` re-extracts the shadow with the SAME mode and defaults to the SAME
    // profile — otherwise an --unsafe-show-secrets export would be redacted back
    // to placeholders, or a --profile supabase export applied as raw would read
    // the target's platform state as drift and drop it (review P1/P2).
    const exportProfileId = ctx.planOptions.profile?.id;
    const removed = writeExportFiles(outRoot, files, {
      redactSecrets,
      scope: exportScope,
      ...(exportProfileId !== undefined ? { profile: exportProfileId } : {}),
      // stamp the baseline digest so `schema apply` fails loud if the profile it
      // resolves subtracts a different (or no) baseline — otherwise the platform
      // objects this export omitted would read as source-only drops.
      ...(ctx.baseline !== undefined
        ? { baselineDigest: ctx.baseline.digest }
        : {}),
      // stamp the resolved default owner (database scope only) so `schema apply`
      // reconstructs the identical view and guards a divergent applier. A role
      // name or `null` (verbose); omitted at cluster scope (ownership managed).
      ...(exportScope === "database"
        ? { defaultOwner: resolvedDefaultOwner }
        : {}),
    });
    if (removed.length > 0) {
      process.stderr.write(
        `Removed ${removed.length} stale .sql file(s) from ${outDir}\n`,
      );
    }
    process.stderr.write(
      `Exported ${files.length} file(s) to ${outDir} (layout: ${layout})\n`,
    );
  } finally {
    await src.end();
  }
}

/** Discriminated result of {@link prepareApplyFiles}. */
export type PreparedApplyFiles =
  | { ok: true; files: SqlFile[]; skipped: { file: string; stmt: string }[] }
  | { ok: false; message: string };

/**
 * Collect and validate the declarative SQL files for `schema apply`, applying the
 * database-scope cluster-DDL policy. Returns the loadable files (plus a skip
 * ledger) or a refusal message. Extracted from `cmdSchemaApply` so the guards
 * are unit-testable. Refuses when:
 *  - no file carries executable SQL (a wrong/empty `--dir` → empty shadow →
 *    destructive drop-all);
 *  - database scope and cluster DDL is present without `--skip-cluster-ddl`;
 *  - database scope + `--skip-cluster-ddl` strips EVERY executable statement — an
 *    all-cluster-DDL dir would otherwise build an empty shadow and drop-all
 *    (Codex P1: the up-front guard passes on the original files, so the emptiness
 *    must be re-checked after stripping).
 */
export function prepareApplyFiles(
  dir: string,
  scope: "database" | "cluster",
  skipClusterDdl: boolean,
): PreparedApplyFiles {
  let files = collectSqlFiles(dir);
  const hasExecutableSql = (fs: SqlFile[]): boolean =>
    fs.some((f) => scanTokens(f.sql).length > 0);

  if (!hasExecutableSql(files)) {
    return {
      ok: false,
      message: `no executable SQL found under ${dir} (${files.length} file(s), all missing/empty/comment-only). Refusing to apply an empty desired state (it would drop every managed object on the target). Check the --dir path.`,
    };
  }

  const skipped: { file: string; stmt: string }[] = [];
  if (scope === "database") {
    const offenders = files
      .map((f) => ({ name: f.name, labels: findClusterDdlStatements(f.sql) }))
      .filter((x) => x.labels.length > 0);
    if (offenders.length > 0) {
      if (!skipClusterDdl) {
        const detail = offenders
          .map(({ name, labels }) => `  ${name}: ${labels.join(", ")}`)
          .join("\n");
        return {
          ok: false,
          message:
            `--scope database does not manage cluster-global roles, but found cluster DDL:\n${detail}\n` +
            `Use --scope cluster (with --isolated-shadow) to manage roles, or --skip-cluster-ddl to skip these statements.`,
        };
      }
      files = files.map((f) => {
        const { kept, skipped: sk } = stripClusterDdl(f.sql);
        for (const s of sk) {
          skipped.push({ file: f.name, stmt: s.split("\n")[0] ?? "" });
        }
        return { ...f, sql: kept };
      });
      // Re-check after stripping: an all-cluster-DDL dir is now empty, which would
      // build an empty shadow and plan a destructive drop-all of every managed
      // object. The up-front guard above ran on the ORIGINAL files, so it passed.
      if (!hasExecutableSql(files)) {
        return {
          ok: false,
          message: `after --skip-cluster-ddl, no executable database-scope SQL remains under ${dir}. Refusing to apply an empty desired state (it would drop every managed object on the target).`,
        };
      }
    }
  }
  return { ok: true, files, skipped };
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
      "no-reorder": { type: "boolean" },
      "unsafe-show-secrets": { type: "boolean" },
      "isolated-shadow": { type: "boolean" },
      scope: { type: "value" },
      "skip-cluster-ddl": { type: "boolean" },
      "keep-shadow": { type: "boolean" },
    });
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(
        `${err.message}\nUsage: pgdelta schema apply --dir <dir> --target <pg-url> [--shadow <pg-url>] ` +
          `[--renames auto|prompt|off] [--force] [--accept-rename <from>=<to>] ... ` +
          `[--profile ${PROFILE_IDS}] [--restrict-to-applier] [--strict-coverage] [--strict-function-bodies] [--no-reorder] [--unsafe-show-secrets] [--isolated-shadow] [--scope database|cluster] [--skip-cluster-ddl] [--keep-shadow]\n` +
          `  --shadow omitted: a co-located shadow database is created on the target's cluster (database scope only) and dropped after.\n`,
      );
      process.exit(2);
    }
    throw err;
  }

  const { flags } = parsed;
  const dir = flags["dir"];
  const shadowFlag = flags["shadow"];
  const targetUrl = flags["target"];
  const force = flags["force"];
  const acceptRenameRaw = flags["accept-rename"];

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
    process.stderr.write(
      `--scope must be database or cluster (got: ${scopeFlag})\n`,
    );
    process.exit(2);
  }
  if (
    (scopeFlag === "database" || scopeFlag === "cluster") &&
    manifest?.scope !== undefined &&
    scopeFlag !== manifest.scope
  ) {
    process.stderr.write(
      `--scope ${scopeFlag} contradicts the export manifest scope (${manifest.scope}); re-export or drop --scope.\n`,
    );
    process.exit(2);
  }
  let scope: ManagementScope = "database";
  if (scopeFlag === "database" || scopeFlag === "cluster") {
    scope = scopeFlag;
  } else if (manifest?.scope !== undefined) {
    scope = manifest.scope;
  }
  if (scope === "cluster" && !flags["isolated-shadow"]) {
    process.stderr.write(
      `--scope cluster manages cluster-global roles and must run against a dedicated shadow cluster; pass --isolated-shadow.\n`,
    );
    process.exit(2);
  }

  // --renames default for CLI is "prompt"
  let renames: RenameMode = "prompt";
  if (flags["renames"] !== undefined) {
    const v = flags["renames"];
    if (v !== "auto" && v !== "prompt" && v !== "off") {
      process.stderr.write(
        `--renames must be auto, prompt, or off (got: ${v})\n`,
      );
      process.exit(2);
    }
    renames = v;
  }

  // parse --accept-rename <from>=<to> entries
  const acceptRenames: Array<{ from: StableId; to: StableId }> = [];
  for (const entry of acceptRenameRaw) {
    const eqIdx = entry.indexOf("=");
    if (eqIdx === -1) {
      process.stderr.write(
        `--accept-rename value must be in <from>=<to> form (got: ${entry})\n`,
      );
      process.exit(2);
    }
    const fromStr = entry.slice(0, eqIdx);
    const toStr = entry.slice(eqIdx + 1);
    try {
      acceptRenames.push({ from: parseId(fromStr), to: parseId(toStr) });
    } catch (e) {
      process.stderr.write(
        `--accept-rename: invalid stable-id in "${entry}": ${e instanceof Error ? e.message : String(e)}\n`,
      );
      process.exit(2);
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
    process.stderr.write(`schema apply: ${prepared.message}\n`);
    process.exit(2);
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
  let profileId: string | undefined;
  try {
    profileId = effectiveProfileId(flags["profile"], manifestProfile);
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(2);
    }
    throw err;
  }

  // Resolve the shadow: an explicit --shadow, else a co-located throwaway
  // database created on the TARGET's own cluster (quick mode). Co-located is
  // database scope only — it shares the target's cluster, so it must never carry
  // cluster-global role DDL. The created database is dropped in the finally.
  let coLocated: CoLocatedShadow | undefined;
  let shadowUrl: string;
  if (shadowFlag !== undefined) {
    shadowUrl = shadowFlag;
  } else {
    if (scope === "cluster") {
      process.stderr.write(
        `schema apply --scope cluster needs an explicit --shadow to a dedicated cluster; a co-located shadow (no --shadow) is database scope only.\n`,
      );
      process.exit(2);
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
        process.stderr.write(`schema apply: ${e.message}\n`);
        process.exit(2);
      }
      throw e;
    }
    shadowUrl = coLocated.url;
    process.stderr.write(`  Created shadow database ${coLocated.name}\n`);
  }

  const shadow = makePool(shadowUrl);
  const tgt = makePool(targetUrl);
  // Close the pools and drop the co-located throwaway database. Shared by the
  // normal `finally` AND the early-exit guards inside the try below: those call
  // `process.exit`, which SKIPS the finally, so without releasing here first
  // they would leak the co-located shadow database (`--keep-shadow` keeps it).
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
    // Secret redaction applies to BOTH sides so the diff stays consistent. With
    // --unsafe-show-secrets the declarative SQL's real FDW/server credentials and
    // subscription conninfo flow through the shadow extract unredacted and apply
    // to the target verbatim (round-tripping a trusted `schema export
    // --unsafe-show-secrets`); otherwise both sides redact and a credential-only
    // change is invisible (review P2). The extractor prints the loud "Secret
    // redaction is DISABLED" diagnostic when off.
    //
    // Prefer the redaction mode `schema export` recorded in the directory's
    // manifest, so a `--unsafe-show-secrets` export re-loads its real credentials
    // without the operator re-passing the flag (and a redacted export is not
    // silently applied unredacted). The flag remains the fallback for directories
    // without a manifest (older exports / hand-authored dirs). Computed BEFORE
    // profile resolution so a profile-declared baseline captured in the other
    // mode is rejected.
    const redactSecrets =
      manifest?.redactSecrets ?? !flags["unsafe-show-secrets"];

    // resolve the profile against the TARGET pool (the apply target): this
    // composes handler-aware extraction, policy, baseline, and — with
    // --restrict-to-applier — the applier capability, exactly as the DB-to-DB
    // `plan` command does, so SQL-file apply == DB-to-DB plan (review P1).
    const ctx = await resolveCliProfile(tgt.pool, profileId, {
      restrictToApplier: flags["restrict-to-applier"],
      redactSecrets,
    });

    // Reconcile the baseline this profile resolves against the digest the export
    // recorded: a directory whose platform objects were omitted by a baseline
    // must not be applied under a profile that subtracts a DIFFERENT (or no)
    // baseline, or those platform objects read as source-only drops (Codex #323
    // findings 1+2). No manifest (hand-authored dir) → nothing to reconcile.
    if (manifest !== undefined) {
      reconcileBaselineDigest(
        manifest.baselineDigest,
        ctx.baseline?.digest,
        "export manifest",
      );
    }

    // Resolve the DEFAULT OWNER the export kept implicit, so plan/apply/prove
    // reconstruct the identical database-scope managed view. The manifest field
    // is three-valued:
    //   - a role NAME → use it, and GUARD: the target connection role MUST equal
    //     it, or objects it left implicitly owned would reload owned by a
    //     different role → spurious ownership drift. Fail closed (exit 2).
    //   - null → verbose export (every OWNER TO explicit); no default, no guard.
    //   - ABSENT (pre-feature / hand-authored dir) → resolve the chain against
    //     the TARGET (profile default > target `datdba`) and WARN.
    // Only applies under database scope (cluster scope manages ownership fully).
    let applyDefaultOwner: string | undefined;
    if (scope === "database") {
      const mdo = manifest?.defaultOwner; // string | null | undefined
      if (typeof mdo === "string") {
        const cu = (
          await tgt.pool.query<{ u: string }>(`SELECT current_user AS u`)
        ).rows[0]?.u;
        if (cu !== mdo) {
          process.stderr.write(
            `schema apply: the export's default owner "${mdo}" does not match the target ` +
              `connection role "${cu}". Objects the export left implicitly owned by "${mdo}" ` +
              `would reload owned by "${cu}", producing spurious ownership drift.\n` +
              `  Resolve one of:\n` +
              `    - connect as "${mdo}" (--target <url for ${mdo}>), or\n` +
              `    - re-export with --default-owner "${cu}", or\n` +
              `    - re-export with --default-owner none (emit every OWNER TO).\n`,
          );
          // release first: process.exit skips the finally that drops the
          // co-located shadow this apply already provisioned above.
          await releaseResources();
          process.exit(2);
        }
        // An explicit --shadow loads the omitted-`OWNER TO` objects as ITS OWN
        // connection role. If that role differs from the stamped default, those
        // objects reload owned by the shadow user and — since the projection
        // prunes only owner edges to the default — the plan emits spurious
        // `ALTER … OWNER TO <shadow user>` (or fails the requirement guard when
        // that role is absent on the target). Guard it too. The co-located
        // shadow needs no check: it reuses the same target credentials validated
        // above.
        if (shadowFlag !== undefined) {
          const scu = (
            await shadow.pool.query<{ u: string }>(`SELECT current_user AS u`)
          ).rows[0]?.u;
          if (scu !== mdo) {
            process.stderr.write(
              `schema apply: the export's default owner "${mdo}" does not match the --shadow ` +
                `connection role "${scu}". Objects the export left implicitly owned by "${mdo}" ` +
                `would load into the shadow owned by "${scu}", producing spurious ownership drift.\n` +
                `  Resolve one of:\n` +
                `    - point --shadow at a connection whose role is "${mdo}", or\n` +
                `    - re-export with --default-owner none (emit every OWNER TO).\n`,
            );
            await releaseResources();
            process.exit(2);
          }
        }
        applyDefaultOwner = mdo;
      } else if (mdo === null) {
        applyDefaultOwner = undefined; // verbose export — no implicit default
      } else {
        // Manifest field ABSENT (pre-feature export / hand-authored dir): the
        // directory never opted into default-owner suppression, so apply it
        // VERBOSE — the files are the whole truth and every `OWNER TO` they
        // contain is honored as written. Do NOT synthesize a default from the
        // profile/datdba and prune owner edges to it: that silently drops an
        // explicit `ALTER … OWNER TO <role>` when the target object is owned by
        // a different role. Suppression is an export-time choice the manifest
        // records; a manifest-less dir made no such choice.
        applyDefaultOwner = undefined;
        process.stderr.write(
          `  NOTE: the directory records no default owner, so it is applied verbose ` +
            `(all ownership honored as written). Re-export with the current pg-delta to ` +
            `record a default owner.\n`,
        );
      }
    }

    // Extension shadow precheck: some extensions (pg_cron) can only run their
    // DDL/intent in a specific database, so a declarative dir containing such
    // statements could never load into an arbitrary shadow. Fail EARLY with a
    // clear remediation instead of a mid-load "function does not exist" stuck
    // error. Handlers without a precheck (pg_partman, pgmq) skip this.
    for (const handler of ctx.handlers) {
      const precheck = handler.shadowPrecheck;
      if (precheck === undefined) continue;
      const matched = files.filter(
        (f) =>
          findMatchingStatements(f.sql, (s) => precheck.matchesStatement(s))
            .length > 0,
      );
      if (matched.length === 0) continue;
      const verdict = await precheck.capable((sql) =>
        shadow.pool.query(sql).then((r) => r.rows),
      );
      if (!verdict.capable) {
        throw new UsageError(
          `${matched.length} file(s) contain ${handler.extension} statements ` +
            `(${matched.map((f) => f.name).join(", ")}) but the shadow database cannot ` +
            `execute them: ${verdict.reason}. ` +
            `Apply from a cluster whose shadow IS the ${handler.extension} database ` +
            `(pass --shadow pointing at it), or exclude ${handler.extension} intent from the ` +
            `managed view (a profile baseline / policy filter).`,
        );
      }
    }

    // Extract the target FIRST (Phase 2b): the co-located seed is derived from
    // it, and the SAME result is reused as the diff source below — no second
    // extract.
    process.stderr.write("Extracting target...\n");
    const tExtract0 = Date.now();
    const targetResult = await ctx.extract(tgt.pool, { redactSecrets });
    const extractMs = Date.now() - tExtract0;
    process.stderr.write(
      `  Target: ${targetResult.factBase.facts().length} facts\n`,
    );

    // Database scope: roles are ambient (assumed present at apply time), not
    // managed. Capture the target's role names BEFORE projecting so a
    // `GRANT … TO <role>` resolves against a role that exists on the target (and
    // one that does NOT fails loudly at plan time via the requirement guard),
    // then project role/membership facts (and their owner edges) out of BOTH
    // diff sides. Without this, a shared/co-located shadow's cluster-global roles
    // diff as a spurious `CREATE ROLE` (shadow-only) or a destructive `DROP ROLE`
    // (target-only). Cluster scope is identity (roles are managed state).
    const assumedTargetRoles =
      scope === "database"
        ? targetResult.factBase
            .facts()
            .filter((f) => f.id.kind === "role")
            .map((f) => (f.id as { name: string }).name)
        : [];

    // Phase 2b (#41): when using a co-located shadow under a profile that assumes
    // platform schemas (e.g. --profile supabase), seed those schemas' objects
    // (auth.users, system extensions) into the FRESH shadow BEFORE loading user
    // files, so a user trigger/view on a platform table resolves during the load.
    // The seed re-extracts reference-only, so it cancels symmetrically in the
    // plan. An explicit --shadow keeps bring-your-own-bootstrap; the `raw`
    // profile has no assumedSchemas so `deriveAssumedSchemaSeed` returns nothing.
    let seededSchemas: string[] = [];
    let seededRoutines = new Map<string, string>();
    let seedMs = 0;
    if (coLocated !== undefined) {
      const flatProfile = ctx.planOptions.policy
        ? flattenPolicy(ctx.planOptions.policy)
        : undefined;
      const profileAssumedSchemas = flatProfile?.assumedSchemas ?? [];
      if (profileAssumedSchemas.length > 0) {
        const seed = deriveAssumedSchemaSeed(targetResult.factBase, {
          ...(ctx.planOptions.policy ? { policy: ctx.planOptions.policy } : {}),
          ...(ctx.planOptions.capability
            ? { capability: ctx.planOptions.capability }
            : {}),
          ...(ctx.planOptions.baseline
            ? { baseline: ctx.planOptions.baseline }
            : {}),
          assumedSchemas: profileAssumedSchemas,
          // policy assumed roles PLUS the target's own role names (same cluster,
          // so every owner/grant reference in the seed is present at replay).
          assumedRoles: [
            ...(flatProfile?.assumedRoles ?? []),
            ...assumedTargetRoles,
          ],
          // SUSET (superuser-context) GUCs to strip from the seed: probed by
          // resolveProfile (src/integrations/profile.ts), gated on the target
          // connection's role actually being a non-superuser — see
          // `ResolvedProfile.susetGucs`'s doc comment for why.
          ...(ctx.susetGucs !== undefined ? { susetGucs: ctx.susetGucs } : {}),
        });
        if (seed.sql !== "") {
          process.stderr.write(
            `Seeding shadow with ${seed.facts} assumed-schema object(s) [${seed.schemas.join(", ")}]...\n`,
          );
          const tSeed0 = Date.now();
          try {
            await shadow.pool.query(seed.sql);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            throw new Error(
              `Failed to seed the co-located shadow with the target's assumed-schema objects: ${msg}\n` +
                `  A platform object likely depends on an extension member or type the seed does not reproduce. ` +
                `Pass an explicit --shadow to a database you bootstrap yourself.`,
            );
          }
          seedMs = Date.now() - tSeed0;
          seededSchemas = seed.schemas;
          seededRoutines = seed.seededRoutines;
          process.stderr.write(`  Seeded in ${seedMs}ms\n`);
        }
      }
    }

    process.stderr.write("Loading SQL files into shadow...\n");
    process.stderr.write(`  ${files.length} file(s) found\n`);

    // Reorder is on by default: split files into one-statement units and
    // topologically pre-sort them so the shadow loader becomes statement-granular
    // and tolerates intra-file ordering / inline-FK splits (target-arch §4.4.1).
    // --no-reorder reproduces the raw file-granular behavior for debugging. The
    // assist is advisory — Postgres still elaborates the shadow (P1) — so on a
    // stuck load we only rewrite the synthetic ordinal names in the loader's
    // error back to real `file:line:col`, leaving the PG text authoritative.
    const reorder = !flags["no-reorder"];
    let orderedFiles: OrderedSqlFile[] | null = null;
    let cycles: ShadowLoadCycle[] = [];
    let loadInput: SqlFile[] = files;
    if (reorder) {
      // @supabase/pg-topo is an OPTIONAL peer; if it's absent analyzeForShadow
      // throws ReorderUnavailableError. The assist is advisory, so fall back to
      // raw, file-granular loading rather than fail the whole apply (review P2).
      let analyzed: Awaited<ReturnType<typeof analyzeForShadow>> | null = null;
      try {
        analyzed = await analyzeForShadow(files);
      } catch (err) {
        if (!(err instanceof ReorderUnavailableError)) throw err;
        process.stderr.write(
          `  WARNING: reorder assist unavailable (optional peer @supabase/pg-topo not installed). Loading files raw at file granularity; install it or pass --no-reorder to silence this.\n`,
        );
      }
      if (analyzed === null) {
        // raw file-granular load (orderedFiles=null / loadInput=files)
      } else {
        // Two conditions make the reorder assist unsafe; in both we fall back to
        // raw, file-granular loading (the --no-reorder behavior, which preserves
        // the authored lexicographic order) rather than silently degrade:
        //
        // 1. A pg-topo PARSE_ERROR/DISCOVERY_ERROR returns NO statement nodes for
        //    the offending file, so the reordered input would silently OMIT it and
        //    plan destructive changes against a partial desired state. Raw loading
        //    sends the bad file to Postgres, which fails loudly (review P1).
        // 2. Session-setting statements (SET search_path / SET ROLE / SET SESSION
        //    AUTHORIZATION) are classed by pg-topo as no-dependency bootstrap and
        //    can be moved relative to the DDL they scope, changing the shadow
        //    state. Raw loading keeps them in their authored position (review P1).
        // 3. ALTER DEFAULT PRIVILEGES is classed by pg-topo in its `privileges`
        //    phase (after creates), but PostgreSQL applies a schema's default
        //    privileges only to objects created AFTER it in authored order;
        //    reordering it past a CREATE drops those implicit ACLs (review P2).
        //    HAND-AUTHORED dirs only: an EXPORTED dir (manifest present) never
        //    relies on implicit ADP grants — the exporter emits explicit
        //    per-object REVOKE/GRANT for every object (enforced invariant,
        //    pinned across objtypes by tests/export-fidelity.test.ts), so ADP
        //    position is semantics-free there and the assist stays available.
        const parseErrors = analyzed.diagnostics.filter(
          (d) => d.code === "PARSE_ERROR" || d.code === "DISCOVERY_ERROR",
        );
        const sessionSettingFiles = files.filter(
          (f) => findSessionSettingStatements(f.sql).length > 0,
        );
        const defaultPrivFiles =
          manifest === undefined
            ? files.filter(
                (f) => findDefaultPrivilegeStatements(f.sql).length > 0,
              )
            : [];

        if (
          parseErrors.length > 0 ||
          sessionSettingFiles.length > 0 ||
          defaultPrivFiles.length > 0
        ) {
          const reasons: string[] = [];
          if (parseErrors.length > 0) {
            reasons.push(
              `pg-topo could not parse ${parseErrors.length} input(s) — reordering would silently drop them`,
            );
          }
          if (sessionSettingFiles.length > 0) {
            reasons.push(
              `session-setting statements (e.g. SET search_path / SET ROLE) in ${sessionSettingFiles
                .map((f) => f.name)
                .join(", ")} must not be reordered`,
            );
          }
          if (defaultPrivFiles.length > 0) {
            reasons.push(
              `ALTER DEFAULT PRIVILEGES in ${defaultPrivFiles
                .map((f) => f.name)
                .join(", ")} must not be reordered past the objects it scopes`,
            );
          }
          process.stderr.write(
            `  WARNING: reorder assist disabled — ${reasons.join(
              "; ",
            )}. Loading files raw at file granularity; fix the file(s) or pass --no-reorder to silence this.\n`,
          );
          // leave orderedFiles=null / loadInput=files → raw file-granular load
        } else {
          orderedFiles = analyzed.files;
          cycles = analyzed.cycles;
          loadInput = analyzed.files;
          process.stderr.write(
            `  Reordered into ${analyzed.files.length} statement(s) (use --no-reorder to disable)\n`,
          );
        }
      }
    }
    // Any raw file-granular load — `--no-reorder`, a missing pg-topo peer, OR
    // reorder disabled by diagnostics — can defer a failing ALTER DEFAULT
    // PRIVILEGES past the objects it scopes (the retry loop applies it in a later
    // round, after those objects are created), so objects relying on ADP-implicit
    // default grants may not receive them. Surface the caveat on EVERY raw path,
    // not only the diagnostics one (review P2). pg-delta's own `schema export`
    // sidesteps this by writing each object's ACL explicitly.
    if (orderedFiles === null) {
      const adpFiles = files.filter(
        (f) => findDefaultPrivilegeStatements(f.sql).length > 0,
      );
      if (adpFiles.length > 0) {
        process.stderr.write(
          `  NOTE: raw loading may apply ALTER DEFAULT PRIVILEGES AFTER objects created in the same load, so objects relying on ADP-implicit default grants may not receive them. Grant those privileges explicitly (as \`schema export\` does).\n`,
        );
      }
    }

    const originalSqlByName = new Map(files.map((f) => [f.name, f.sql]));

    // the shadow desired state must be projected with the SAME handlers as the
    // target, so pass the profile extractor through to loadSqlFiles.
    let loadResult;
    const tLoad0 = Date.now();
    try {
      loadResult = await loadSqlFiles(loadInput, shadow.pool, {
        extract: (p, o) => ctx.extract(p, { ...o, redactSecrets }),
        // Phase 2b: exempt the pre-seeded assumed schemas from the shadow-
        // emptiness guard (they were deliberately populated above), and pass the
        // seeded-routine identity map so body-validation leniency is scoped to
        // routines the seed actually created — a user routine merely living in a
        // seeded schema NAME must still fail loudly (Codex #329). Always pass the
        // map (even empty) once we seeded, so the identity gating fully replaces
        // the schema-name gating for the CLI path.
        ...(seededSchemas.length > 0 ? { seededSchemas, seededRoutines } : {}),
        // `--strict-function-bodies` restores the fatal gate for a USER routine
        // whose body fails the check-on re-validation. Default (flag absent) is
        // lenient: such a failure is a loud warning and the load proceeds, since
        // apply materialises exactly what was declared under check-off anyway.
        strictFunctionBodies: flags["strict-function-bodies"] === true,
        // A declarative dir that carries cluster-level role state (CREATE ROLE,
        // membership grants — e.g. `cluster/roles.sql`) trips the default
        // `databaseScratch` leak guard. `--isolated-shadow` asserts the shadow is
        // a dedicated cluster, so role state can load without a false leak error.
        ...(flags["isolated-shadow"]
          ? { mode: "isolatedCluster" as const }
          : {}),
      });
    } catch (error) {
      if (error instanceof ShadowLoadError && orderedFiles) {
        // rewrite synthetic ordinal names back to real file:line:col, then —
        // only on a genuinely non-converging load — attach the assist's cycle
        // members as a clearly-labeled advisory hint (D6). The loader's
        // Postgres-driven errors stay first and authoritative.
        let enriched = rewriteReorderedShadowError(
          error,
          orderedFiles,
          originalSqlByName,
        );
        const nonConverging = error.details.some(
          (d) =>
            d.code === "stuck_statement" || d.code === "max_rounds_exceeded",
        );
        if (nonConverging) {
          enriched = appendShadowCycleHint(enriched, cycles, originalSqlByName);
        }
        throw enriched;
      }
      throw error;
    }
    const loadMs = Date.now() - tLoad0;
    process.stderr.write(
      `  Shadow loaded: ${loadResult.factBase.facts().length} facts (${loadResult.rounds} round(s))\n`,
    );

    // surface loader + target extraction diagnostics; --strict-coverage refuses
    // to apply while user objects the engine cannot manage exist (finding 2).
    // targetResult was extracted before the seed (above) and is reused here.
    printDiagnostics(loadResult.diagnostics, { label: "shadow" });
    printDiagnostics(targetResult.diagnostics, { label: "target" });
    exitIfBlocking([...loadResult.diagnostics, ...targetResult.diagnostics], {
      strictCoverage: flags["strict-coverage"],
      action: "apply",
    });

    // targetResult + assumedTargetRoles were computed before the seed (above).
    // Pass the RAW fact bases and the scope: plan() resolves the policy managed
    // view FIRST and projects the scope out SECOND (change-set.ts), the same
    // proven-correct order `schema export` uses. Projecting scope here (before
    // plan's resolveView) would strip the owner edges a policy owner-exclusion
    // rule reads and wrongly plan a DROP of a system-owned platform object.
    const sourceFb = targetResult.factBase;
    const desiredFb = loadResult.factBase;

    const planOptions = {
      renames,
      scope,
      ...(acceptRenames.length > 0 ? { acceptRenames } : {}),
      ...ctx.planOptions, // policy, capability, baseline (from the profile)
      ...(assumedTargetRoles.length > 0
        ? {
            assumedRoles: [
              ...(ctx.planOptions.assumedRoles ?? []),
              ...assumedTargetRoles,
            ],
          }
        : {}),
      // the default owner the export kept implicit; plan stamps it so the apply
      // fingerprint gate reconstructs the identical view.
      ...(applyDefaultOwner !== undefined
        ? { defaultOwner: applyDefaultOwner }
        : {}),
    };
    const tPlan0 = Date.now();
    const thePlan = plan(sourceFb, desiredFb, planOptions);
    const planMs = Date.now() - tPlan0;
    process.stderr.write(`Planning: ${thePlan.actions.length} action(s)\n`);
    // Phase 2b: per-phase timing informs whether a dir-hash cache (Phase 3) is
    // ever worth it. seed is 0 unless a co-located shadow was seeded.
    process.stderr.write(
      `  timings: seed ${seedMs}ms · load ${loadMs}ms · extract ${extractMs}ms · plan ${planMs}ms\n`,
    );

    // print rename candidates in prompt mode
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

    if (thePlan.actions.length === 0) {
      process.stderr.write("Target is already up to date.\n");
      return;
    }

    if (force) {
      process.stderr.write("WARNING: --force disables the fingerprint gate.\n");
    }

    const report = await apply(thePlan, tgt.pool, {
      ...ctx.applyOptions, // baseline + handler-aware re-extract (from the profile)
      // the fingerprint gate re-extracts the target and compares to the plan
      // source; that source used `redactSecrets`, so the re-extract must too —
      // otherwise --unsafe-show-secrets trips the gate against unredacted
      // credentials. The scope projection is NOT applied here: apply() runs it
      // AFTER resolveView (reading the plan's stamped scope), matching plan's
      // managed-view-under-scope order — projecting scope here would strip the
      // owner edges a policy rule reads and trip the gate against a different
      // view than the plan fingerprinted (§scope).
      reextract: (p) => ctx.extract(p, { redactSecrets }),
      fingerprintGate: !force,
    });

    if (report.status === "applied") {
      process.stderr.write(
        `Applied ${report.appliedActions} action(s) successfully.\n`,
      );
    } else {
      process.stderr.write("Apply failed!\n");
      if (report.error) {
        process.stderr.write(
          `  action[${report.error.actionIndex}]: ${report.error.message}\n`,
        );
        process.stderr.write(`  sql: ${report.error.sql}\n`);
      }
      // release first: process.exit skips the finally (co-located shadow leak).
      await releaseResources();
      process.exit(1);
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
    });
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(
        `${err.message}\nUsage: pgdelta schema lint --dir <dir>\n`,
      );
      process.exit(2);
    }
    throw err;
  }

  const { flags } = parsed;
  const dir = flags["dir"];
  const files = collectSqlFiles(dir);
  if (files.length === 0) {
    process.stderr.write(`No .sql files found in ${dir}.\n`);
    return;
  }

  // Pure static analysis — no shadow/target database. Surfaces pg-topo
  // diagnostics (cycles, unknown statements, duplicate producers, …) for
  // proactive authoring; deliberately kept OUT of the apply path so apply stays
  // Postgres-truth. Throws ReorderUnavailableError (with an install hint) when
  // @supabase/pg-topo is absent.
  const { cycles, diagnostics } = await analyzeForShadow(files);
  const originalSqlByName = new Map(files.map((f) => [f.name, f.sql]));
  const report = formatLintReport({ cycles, diagnostics }, originalSqlByName);

  process.stderr.write(`Linted ${files.length} file(s) in ${dir}.\n`);
  for (const line of report.lines) {
    process.stderr.write(`  ${line}\n`);
  }
  if (report.lines.length === 0) {
    process.stderr.write("No issues found.\n");
  } else {
    process.stderr.write(
      `\n${report.errorCount} error(s), ${report.warningCount} warning(s).\n`,
    );
  }
  if (report.blocking) {
    process.exit(1);
  }
}
