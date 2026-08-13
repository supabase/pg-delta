/**
 * Library frontend: plan declarative SQL files against a live target using a
 * supplied shadow pool. No argv / stdout / process.exit — callers own both
 * pools (`pool.end()`) and any co-located shadow cleanup.
 */
import type { Pool } from "pg";
import type { ApplyOptions } from "../apply/apply.ts";
import type { Diagnostic } from "../core/diagnostic.ts";
import type { StableId } from "../core/stable-id.ts";
import {
  isSameDatabase,
  isSamePostgresLineage,
  observeDatabaseIdentityForMutation,
} from "../database-identity.ts";
import type { ExtractOptions, ExtractResult } from "../extract/extract.ts";
import {
  detectUnmodeledDrift,
  probeUnmodeledIdentities,
  type UnmodeledIdentities,
} from "../extract/unmodeled.ts";
import {
  type IntegrationProfile,
  resolveProfile,
  type ResolveProfileOptions,
  type ResolvedProfile,
} from "../integrations/profile.ts";
import { plan, type Plan, type PlanOptions } from "../plan/plan.ts";
import type { RenameMode } from "../plan/renames.ts";
import { flattenPolicy } from "../policy/policy.ts";
import type { ManagementScope } from "../policy/view.ts";
import { scanTokens } from "./sql-format/tokenizer.ts";
import type { ExportManifest } from "./export-manifest.ts";
import {
  findClusterDdlStatements,
  findDefaultPrivilegeStatements,
  findMatchingStatements,
  findSessionSettingStatements,
  loadSqlFiles,
  ShadowLoadError,
  stripClusterDdl,
  type SqlFile,
} from "./load-sql-files.ts";
import { deriveAssumedSchemaSeed } from "./seed-assumed-schemas.ts";
import {
  analyzeForShadow,
  ReorderUnavailableError,
  type OrderedSqlFile,
  type ShadowLoadCycle,
} from "./sql-order.ts";

/**
 * {@link probeUnmodeledIdentities}, pinned to the SAME canonical search_path
 * extraction uses (`extract.ts`: `SET LOCAL search_path TO 'pg_catalog'`).
 *
 * The probes' catalog references (`src/extract/unmodeled.ts`, `PROBES[].from`)
 * are UNQUALIFIED — e.g. `FROM pg_cast c`. Run pool-level, that resolves via
 * whatever default `search_path` the connecting role/database has. A target
 * with `search_path = app, pg_catalog` and a user relation named `app.pg_cast`
 * makes `pg_cast` resolve to the user table FIRST (Postgres searches an
 * EXPLICITLY listed `pg_catalog` in the stated position, not implicitly
 * first) — so the probe reads the wrong relation, either erroring on missing
 * columns or silently reporting nonsense identities. Extraction already pins
 * its path for exactly this reason; the drift probe must match it, via a
 * short, dedicated transaction so the pool's OTHER borrowers keep their own
 * default path (`SET LOCAL` is discarded on COMMIT/ROLLBACK).
 *
 * @param major - The server's PostgreSQL major version (e.g. `17`); it selects
 * which version-gated probes run. `ExtractResult.pgVersion` /
 * `LoadResult.pgVersion` carry `server_version`, so
 * `Number.parseInt(result.pgVersion, 10)` is the usual source (handles
 * `"17.5"` and `"18beta1"` alike).
 */
export async function probeUnmodeledIdentitiesPinned(
  pool: Pool,
  major: number,
): Promise<UnmodeledIdentities> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL search_path TO pg_catalog");
    const result = await probeUnmodeledIdentities(client, major);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export class SchemaFrontendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaFrontendError";
  }
}

/** Discriminated result of {@link prepareSchemaFiles}. */
export type PreparedSchemaFiles =
  | { ok: true; files: SqlFile[]; skipped: { file: string; stmt: string }[] }
  | { ok: false; message: string };

export interface PrepareSchemaFilesOptions {
  scope: ManagementScope;
  skipClusterDdl?: boolean;
  /** Label used in refusal messages (e.g. a directory path). */
  label?: string;
}

/**
 * Validate declarative SQL files for planning: refuse empty/comment-only input
 * (would build an empty shadow and drop-all) and enforce the database-scope
 * cluster-DDL policy.
 */
export function prepareSchemaFiles(
  input: SqlFile[],
  options: PrepareSchemaFilesOptions,
): PreparedSchemaFiles {
  const label = options.label ?? "input";
  const skipClusterDdl = options.skipClusterDdl === true;
  let files = input;
  const hasExecutableSql = (fs: SqlFile[]): boolean =>
    fs.some((f) => scanTokens(f.sql).length > 0);

  if (!hasExecutableSql(files)) {
    return {
      ok: false,
      message: `no executable SQL found under ${label} (${files.length} file(s), all missing/empty/comment-only). Refusing to apply an empty desired state (it would drop every managed object on the target).`,
    };
  }

  const skipped: { file: string; stmt: string }[] = [];
  if (options.scope === "database") {
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
            `scope database does not manage cluster-global roles, but found cluster DDL:\n${detail}\n` +
            `Use scope cluster (with an isolated shadow) to manage roles, or skipClusterDdl to skip these statements.`,
        };
      }
      files = files.map((f) => {
        const { kept, skipped: sk } = stripClusterDdl(f.sql);
        for (const s of sk) {
          skipped.push({ file: f.name, stmt: s.split("\n")[0] ?? "" });
        }
        return { ...f, sql: kept };
      });
      if (!hasExecutableSql(files)) {
        return {
          ok: false,
          message: `after skipClusterDdl, no executable database-scope SQL remains under ${label}. Refusing to apply an empty desired state (it would drop every managed object on the target).`,
        };
      }
    }
  }
  return { ok: true, files, skipped };
}

export interface ReconcileSchemaManifestFlags {
  profileId?: string;
  scope?: ManagementScope;
  redactSecrets?: boolean;
  /** Digest the caller's resolved profile will subtract; compared to the
   *  manifest when both are present. Pass the key (even as `undefined`) to
   *  enable the baseline check after profile resolution. */
  baselineDigest?: string | undefined;
}

export interface ReconciledSchemaOptions {
  profileId: string | undefined;
  scope: ManagementScope;
  redactSecrets: boolean;
  baselineDigest: string | undefined;
  defaultOwner: string | null | undefined;
}

/**
 * Reconcile caller flags with an export manifest. Fail closed on any
 * contradiction (profile, scope, redaction, baseline). When a flag is omitted,
 * the manifest value (if any) wins; otherwise defaults apply (scope=database,
 * redactSecrets=true).
 */
export function reconcileSchemaManifest(
  manifest: ExportManifest | undefined,
  flags: ReconcileSchemaManifestFlags,
): ReconciledSchemaOptions {
  // profile
  if (
    flags.profileId !== undefined &&
    manifest?.profile !== undefined &&
    flags.profileId !== manifest.profile
  ) {
    throw new SchemaFrontendError(
      `profile "${flags.profileId}" contradicts the export manifest profile (${manifest.profile}); re-export or drop the profile override.`,
    );
  }
  const profileId = flags.profileId ?? manifest?.profile;

  // scope
  if (
    flags.scope !== undefined &&
    manifest?.scope !== undefined &&
    flags.scope !== manifest.scope
  ) {
    throw new SchemaFrontendError(
      `scope ${flags.scope} contradicts the export manifest scope (${manifest.scope}); re-export or drop the scope override.`,
    );
  }
  const scope: ManagementScope = flags.scope ?? manifest?.scope ?? "database";

  // redaction — fail closed when both sides disagree
  if (
    flags.redactSecrets !== undefined &&
    manifest?.redactSecrets !== undefined &&
    flags.redactSecrets !== manifest.redactSecrets
  ) {
    throw new SchemaFrontendError(
      `redactSecrets=${flags.redactSecrets} contradicts the export manifest (redactSecrets=${manifest.redactSecrets}); re-export or drop the redaction override.`,
    );
  }
  const redactSecrets = flags.redactSecrets ?? manifest?.redactSecrets ?? true;

  // baseline — only when the caller supplies a resolved digest to check
  // (`"baselineDigest" in flags`). The pre-resolve pass omits the key so a
  // stamped digest is not treated as "profile declares none".
  if (manifest !== undefined && "baselineDigest" in flags) {
    const stamped = manifest.baselineDigest;
    const resolved = flags.baselineDigest;
    if (stamped !== resolved) {
      if (stamped !== undefined && resolved !== undefined) {
        throw new SchemaFrontendError(
          `baseline mismatch: the export manifest was produced with baseline digest ${stamped.slice(0, 12)} ` +
            `but the profile now resolves to ${resolved.slice(0, 12)}.`,
        );
      }
      if (stamped !== undefined) {
        throw new SchemaFrontendError(
          `baseline mismatch: the export manifest was produced with baseline digest ${stamped.slice(0, 12)} ` +
            `but the profile now declares NO baseline.`,
        );
      }
      throw new SchemaFrontendError(
        `baseline mismatch: the profile declares a baseline (digest ${resolved?.slice(0, 12)}) but the export manifest ` +
          `was produced with NONE.`,
      );
    }
  }

  return {
    profileId,
    scope,
    redactSecrets,
    baselineDigest: manifest?.baselineDigest ?? flags.baselineDigest,
    defaultOwner: manifest?.defaultOwner,
  };
}

export interface PlanSchemaFilesOptions {
  profile: IntegrationProfile;
  /** Explicit scope; reconciled against manifest when both are set. Default: manifest or `"database"`. */
  scope?: ManagementScope;
  /** Export manifest from the directory (or buildSchemaExport). */
  manifest?: ExportManifest;
  redactSecrets?: boolean;
  skipClusterDdl?: boolean;
  /** Load mode: dedicated cluster allows role DDL. Default: false (databaseScratch). */
  isolatedShadow?: boolean;
  /** Seed assumed-schema objects into a co-located (fresh) shadow before load. */
  seedAssumedSchemas?: boolean;
  renames?: RenameMode;
  acceptRenames?: Array<{ from: StableId; to: StableId }>;
  resolveOptions?: Omit<ResolveProfileOptions, "redactSecrets">;
  strictFunctionBodies?: boolean;
  /** Exempt managed tables that already held rows before the shadow load from the
   *  DML observation. Left undefined the loader picks its own default (true for an
   *  isolated shadow, which may be pre-provisioned by a platform). */
  allowPreExistingRows?: boolean;
  /** Make the shadow load's DML observation fatal again (default: warning). */
  strictDataStatements?: boolean;
  /** Statement-reorder assist. Default: true. */
  reorder?: boolean;
  /** Soft warnings (reorder fallback, ADP caveat, …). */
  onWarning?: (message: string) => void;
  /** Optional rewrite of a ShadowLoadError after reorder (CLI attaches file:line). */
  onShadowLoadError?: (
    error: ShadowLoadError,
    ctx: {
      orderedFiles: OrderedSqlFile[] | null;
      cycles: ShadowLoadCycle[];
      originalSqlByName: Map<string, string>;
    },
  ) => Error;
}

/** `current_setting('server_version')` → major (`"17.5"` → 17, `"18beta1"` → 18).
 *  Both `ExtractResult.pgVersion` and `LoadResult.pgVersion` carry that string,
 *  so the drift probe reuses versions already round-tripped rather than asking
 *  each server again. */
function majorOf(pgVersion: string): number {
  return Number.parseInt(pgVersion, 10);
}

export interface PlanSchemaFilesResult {
  plan: Plan;
  loadDiagnostics: Diagnostic[];
  targetDiagnostics: Diagnostic[];
  /**
   * `unmodeled_drift` warnings: unmodeled objects the loaded shadow (desired
   * state) has and the target lacks (docs/architecture/custom-folder.md §7).
   * Unmodeled kinds produce no facts, so the plan can never create them — a
   * planned statement depending on one FAILS on the target. Kept separate from
   * {@link PlanSchemaFilesResult.targetDiagnostics} because this is a comparison
   * of two databases, not the output of extracting either one; a CLI-like
   * frontend should print and gate it alongside the other two sets.
   */
  driftDiagnostics: Diagnostic[];
  skipped: { file: string; stmt: string }[];
  /** Same resolved profile bundles for a subsequent `apply()`. */
  applyOptions: ApplyOptions;
  planOptions: PlanOptions;
  extract: (pool: Pool, options?: ExtractOptions) => Promise<ExtractResult>;
  /** Resolved default owner under database scope (undefined = verbose / N/A). */
  defaultOwner?: string;
  scope: ManagementScope;
  redactSecrets: boolean;
  /** The resolved profile (handlers, baseline meta, …). */
  profile: ResolvedProfile;
}

/**
 * Plan declarative SQL files against a target using a supplied shadow pool.
 * Does not apply and does not end either pool.
 */
export async function planSchemaFiles(
  targetPool: Pool,
  shadowPool: Pool,
  inputFiles: SqlFile[],
  options: PlanSchemaFilesOptions,
): Promise<PlanSchemaFilesResult> {
  // First-pass reconcile without baseline (profile not resolved yet).
  const pre = reconcileSchemaManifest(options.manifest, {
    profileId: options.profile.id,
    ...(options.scope !== undefined ? { scope: options.scope } : {}),
    ...(options.redactSecrets !== undefined
      ? { redactSecrets: options.redactSecrets }
      : {}),
  });

  if (pre.scope === "cluster" && options.isolatedShadow !== true) {
    throw new SchemaFrontendError(
      "scope cluster manages cluster-global roles and must run against a dedicated shadow cluster; pass isolatedShadow: true.",
    );
  }

  const prepared = prepareSchemaFiles(inputFiles, {
    scope: pre.scope,
    skipClusterDdl: options.skipClusterDdl === true,
  });
  if (!prepared.ok) {
    throw new SchemaFrontendError(prepared.message);
  }
  const files = prepared.files;

  // This public frontend owns mutation of the supplied shadow. Observe both
  // pools before profile resolution or SQL loading so a target alias cannot be
  // used as its own shadow, and an isolation assertion cannot disable shared-
  // cluster containment on a sibling database from the target lineage.
  const targetIdentity = await observeDatabaseIdentityForMutation(
    targetPool,
    "planSchemaFiles target safety",
  );
  const shadowIdentity = await observeDatabaseIdentityForMutation(
    shadowPool,
    "planSchemaFiles shadow safety",
  );
  if (isSameDatabase(targetIdentity, shadowIdentity)) {
    throw new SchemaFrontendError(
      `planSchemaFiles: shadow and target are the same observed database (${targetIdentity.database}); refusing to load declarative SQL`,
    );
  }
  if (
    options.isolatedShadow === true &&
    isSamePostgresLineage(targetIdentity, shadowIdentity)
  ) {
    throw new SchemaFrontendError(
      "planSchemaFiles: an isolated shadow requires a different PostgreSQL lineage; the supplied shadow shares the target lineage",
    );
  }

  const redactSecrets = pre.redactSecrets;
  const ctx = await resolveProfile(targetPool, options.profile, {
    ...options.resolveOptions,
    redactSecrets,
  });

  // Second-pass: baseline digest now known.
  reconcileSchemaManifest(options.manifest, {
    profileId: options.profile.id,
    scope: pre.scope,
    redactSecrets,
    baselineDigest: ctx.baseline?.digest,
  });

  const scope = pre.scope;

  // Default owner (database scope): stamped role must match target connection.
  let applyDefaultOwner: string | undefined;
  if (scope === "database") {
    const mdo = options.manifest?.defaultOwner;
    if (typeof mdo === "string") {
      const cu = (
        await targetPool.query<{ u: string }>(`SELECT current_user AS u`)
      ).rows[0]?.u;
      if (cu !== mdo) {
        throw new SchemaFrontendError(
          `the export's default owner "${mdo}" does not match the target ` +
            `connection role "${cu}". Objects the export left implicitly owned by "${mdo}" ` +
            `would reload owned by "${cu}", producing spurious ownership drift.`,
        );
      }
      const scu = (
        await shadowPool.query<{ u: string }>(`SELECT current_user AS u`)
      ).rows[0]?.u;
      if (scu !== mdo) {
        throw new SchemaFrontendError(
          `the export's default owner "${mdo}" does not match the shadow ` +
            `connection role "${scu}". Objects the export left implicitly owned by "${mdo}" ` +
            `would load into the shadow owned by "${scu}", producing spurious ownership drift.`,
        );
      }
      applyDefaultOwner = mdo;
    } else {
      // null (verbose) or absent (pre-feature / hand-authored): no suppression.
      applyDefaultOwner = undefined;
      if (mdo === undefined && options.manifest !== undefined) {
        // manifest present but field absent — note only when we have a manifest
        // without the field (pre-feature). Hand-authored (no manifest) is silent.
        if (!("defaultOwner" in options.manifest)) {
          options.onWarning?.(
            "the directory records no default owner, so it is applied verbose " +
              "(all ownership honored as written). Re-export with the current pg-delta to " +
              "record a default owner.",
          );
        }
      }
    }
  }

  // Extension shadow precheck
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
      shadowPool.query(sql).then((r) => r.rows),
    );
    if (!verdict.capable) {
      throw new SchemaFrontendError(
        `${matched.length} file(s) contain ${handler.extension} statements ` +
          `(${matched.map((f) => f.name).join(", ")}) but the shadow database cannot ` +
          `execute them: ${verdict.reason}.`,
      );
    }
  }

  const targetResult = await ctx.extract(targetPool, { redactSecrets });

  const assumedTargetRoles =
    scope === "database"
      ? targetResult.factBase
          .facts()
          .filter((f) => f.id.kind === "role")
          .map((f) => (f.id as { name: string }).name)
      : [];

  let seededSchemas: string[] = [];
  let seededRoutines = new Map<string, string>();
  if (options.seedAssumedSchemas === true) {
    const flatProfile = ctx.planOptions.policy
      ? flattenPolicy(ctx.planOptions.policy)
      : undefined;
    const profileAssumedSchemas = flatProfile?.assumedSchemas ?? [];
    const profileAssumedPublications = flatProfile?.assumedPublications ?? [];
    // gate on EITHER assumed kind: a profile assuming only publications still
    // needs its shadow seeded (Codex review on #373)
    if (
      profileAssumedSchemas.length > 0 ||
      profileAssumedPublications.length > 0
    ) {
      const seed = deriveAssumedSchemaSeed(targetResult.factBase, {
        ...(ctx.planOptions.policy ? { policy: ctx.planOptions.policy } : {}),
        ...(ctx.planOptions.capability
          ? { capability: ctx.planOptions.capability }
          : {}),
        ...(ctx.planOptions.baseline
          ? { baseline: ctx.planOptions.baseline }
          : {}),
        assumedSchemas: profileAssumedSchemas,
        assumedPublications: profileAssumedPublications,
        assumedRoles: [
          ...(flatProfile?.assumedRoles ?? []),
          ...assumedTargetRoles,
        ],
        ...(ctx.susetGucs !== undefined ? { susetGucs: ctx.susetGucs } : {}),
      });
      if (seed.sql !== "") {
        const seedClient = await shadowPool.connect();
        try {
          // Same PG 16+ CREATEROLE non-superuser grant as loadSqlFiles: seed SQL
          // may CREATE SCHEMA … AUTHORIZATION for assumed owners.
          try {
            await seedClient.query(
              `SELECT set_config('createrole_self_grant', 'set, inherit', false)`,
            );
          } catch {
            /* PG < 16 or GUC unavailable */
          }
          await seedClient.query(seed.sql);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          throw new SchemaFrontendError(
            `Failed to seed the co-located shadow with the target's assumed-schema objects: ${msg}`,
          );
        } finally {
          seedClient.release();
        }
        seededSchemas = seed.schemas;
        seededRoutines = seed.seededRoutines;
      }
    }
  }

  const reorder = options.reorder !== false;
  let orderedFiles: OrderedSqlFile[] | null = null;
  let cycles: ShadowLoadCycle[] = [];
  let loadInput: SqlFile[] = files;
  if (reorder) {
    let analyzed: Awaited<ReturnType<typeof analyzeForShadow>> | null = null;
    try {
      analyzed = await analyzeForShadow(files);
    } catch (err) {
      if (!(err instanceof ReorderUnavailableError)) throw err;
      options.onWarning?.(
        "reorder assist unavailable (optional peer @supabase/pg-topo not installed). Loading files raw at file granularity.",
      );
    }
    if (analyzed !== null) {
      const parseErrors = analyzed.diagnostics.filter(
        (d) => d.code === "PARSE_ERROR" || d.code === "DISCOVERY_ERROR",
      );
      const sessionSettingFiles = files.filter(
        (f) => findSessionSettingStatements(f.sql).length > 0,
      );
      const defaultPrivFiles =
        options.manifest === undefined
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
            `session-setting statements in ${sessionSettingFiles
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
        options.onWarning?.(
          `reorder assist disabled — ${reasons.join("; ")}. Loading files raw at file granularity.`,
        );
      } else {
        orderedFiles = analyzed.files;
        cycles = analyzed.cycles;
        loadInput = analyzed.files;
      }
    }
  }

  if (orderedFiles === null) {
    const adpFiles = files.filter(
      (f) => findDefaultPrivilegeStatements(f.sql).length > 0,
    );
    if (adpFiles.length > 0) {
      options.onWarning?.(
        "raw loading may apply ALTER DEFAULT PRIVILEGES AFTER objects created in the same load, so objects relying on ADP-implicit default grants may not receive them. Grant those privileges explicitly (as schema export does).",
      );
    }
  }

  const originalSqlByName = new Map(files.map((f) => [f.name, f.sql]));

  let loadResult;
  try {
    loadResult = await loadSqlFiles(loadInput, shadowPool, {
      extract: (p, o) => ctx.extract(p, { ...o, redactSecrets }),
      ...(seededSchemas.length > 0 ? { seededSchemas, seededRoutines } : {}),
      strictFunctionBodies: options.strictFunctionBodies === true,
      strictDataStatements: options.strictDataStatements === true,
      // undefined = let the loader default it from the mode
      ...(options.allowPreExistingRows !== undefined
        ? { allowPreExistingRows: options.allowPreExistingRows }
        : {}),
      ...(options.isolatedShadow === true
        ? { mode: "isolatedCluster" as const }
        : {}),
    });
  } catch (error) {
    if (error instanceof ShadowLoadError && orderedFiles) {
      if (options.onShadowLoadError !== undefined) {
        throw options.onShadowLoadError(error, {
          orderedFiles,
          cycles,
          originalSqlByName,
        });
      }
    }
    throw error;
  }

  // Pre-flight guard for the delivery model (docs/architecture/custom-folder.md
  // §7). Raw SQL — `_custom/` included — runs only in the disposable shadow, so
  // the shadow can legitimately hold unmodeled objects the target has never
  // received. Those produce no facts, meaning the diff below is blind to them
  // and the plan cannot create them; a generated statement depending on one
  // fails on the target. Compare the two catalogs and say so BEFORE handing the
  // plan over. Two probe queries per plan, deliberately uncached: the answer is
  // about live state and a stale "no drift" would be worse than no check.
  const driftDiagnostics = detectUnmodeledDrift(
    await probeUnmodeledIdentitiesPinned(
      shadowPool,
      majorOf(loadResult.pgVersion),
    ),
    await probeUnmodeledIdentitiesPinned(
      targetPool,
      majorOf(targetResult.pgVersion),
    ),
  );

  const planOptions: PlanOptions = {
    renames: options.renames ?? "off",
    scope,
    ...(options.acceptRenames !== undefined && options.acceptRenames.length > 0
      ? { acceptRenames: options.acceptRenames }
      : {}),
    ...ctx.planOptions,
    ...(assumedTargetRoles.length > 0
      ? {
          assumedRoles: [
            ...(ctx.planOptions.assumedRoles ?? []),
            ...assumedTargetRoles,
          ],
        }
      : {}),
    ...(applyDefaultOwner !== undefined
      ? { defaultOwner: applyDefaultOwner }
      : {}),
    // stamp the redaction mode the extracts (and thus the fingerprint) were
    // taken under, so a plan archived via `schema apply --out-plan` replays
    // through `apply --plan` with the SAME re-extract mode — an unstamped
    // unredacted plan would read as redacted and trip the fingerprint gate
    // on an unchanged target.
    redactSecrets,
  };

  const thePlan = plan(targetResult.factBase, loadResult.factBase, planOptions);

  return {
    plan: thePlan,
    loadDiagnostics: loadResult.diagnostics,
    targetDiagnostics: targetResult.diagnostics,
    driftDiagnostics,
    skipped: prepared.skipped,
    applyOptions: ctx.applyOptions,
    planOptions,
    extract: ctx.extract,
    ...(applyDefaultOwner !== undefined
      ? { defaultOwner: applyDefaultOwner }
      : {}),
    scope,
    redactSecrets,
    profile: ctx,
  };
}
