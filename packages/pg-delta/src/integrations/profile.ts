/**
 * Integration profile (docs/architecture/managed-view-architecture.md;
 * docs/architecture/extension-intent.md §2).
 *
 * The profile is the ONE module that answers "what state is this engine allowed
 * to manage?" — instead of asking every caller to remember the same sequence of
 * helper calls (handler-aware extraction, policy, baseline, capability, proof
 * re-extraction, apply fingerprint reconstruction).
 *
 * It is split into a STATIC declaration (`IntegrationProfile` — handlers +
 * policy, pure data) and a RUNTIME-resolved context (`ResolvedProfile`).
 * `resolveProfile` resolves capability + baseline ONCE against a source pool and
 * bakes policy + capability + baseline into the plan / prove / apply option
 * bundles, so all three reconstruct the SAME managed view — `plan == prove ==
 * apply` holds by construction (shared option identity), not by comment.
 */
import type { Pool } from "pg";
import type { ApplyOptions } from "../apply/apply.ts";
import {
  extract,
  type ExtractOptions,
  type ExtractResult,
} from "../extract/extract.ts";
import type { ExtensionHandler } from "../extract/handler.ts";
import type { PlanOptions } from "../plan/plan.ts";
import { buildIntentRuleIndex } from "../plan/rules.ts";
import type { ProveOptions } from "../proof/prove.ts";
import {
  type LoadedBaseline,
  loadBaselineFile,
  resolveBaseline,
} from "../policy/baseline.ts";
import { probeApplierCapability } from "../policy/capability.ts";
import { filterSupabasePlatformParameterAclDiagnostics } from "../policy/parameter-acl.ts";
import { flattenPolicy, type Policy } from "../policy/policy.ts";

/** Static, declarative profile: the handlers and policy that define a managed
 *  view. Pure data — no live connection. Compose your own, or use the presets
 *  (`supabaseProfile`, `rawProfile`). */
export interface IntegrationProfile {
  readonly id: string;
  /** Extension handlers, run inside `extract`'s snapshot-bound transaction. */
  readonly handlers: readonly ExtensionHandler[];
  /** Policy supplying scope-filter + serialize rules (and an optional declared
   *  baseline name resolved at `resolveProfile` time). */
  readonly policy?: Policy;
  /** Absolute path to an external baseline snapshot (`pgdelta snapshot` file).
   *  Stays pure data — the FactBase is loaded ONCE at `resolveProfile` time
   *  (the snapshot self-verifies its digest on load). Set by the CLI when a
   *  custom profile file declares `"baseline": "./…"` (resolved relative to the
   *  profile file's directory). Wins over a policy-declared baseline NAME. */
  readonly baselinePath?: string;
}

export interface ResolveProfileOptions {
  /** Probe the source pool's applier capability and restrict the managed view to
   *  operations that applier can execute (e.g. drop superuser-only FDW ACLs). */
  restrictToApplier?: boolean;
  /** Directory to resolve a policy's declared baseline snapshot from (defaults
   *  to the committed `src/policy/baselines/`). */
  baselineDir?: string;
  /** Explicit pre-loaded baseline. The engine-level override seam (library
   *  callers / tests); wins over both `profile.baselinePath` and a policy-declared
   *  baseline name. */
  baseline?: LoadedBaseline;
  /** The redaction mode of the extraction this profile will drive. Validated
   *  against the resolved baseline's recorded mode — a mismatch throws, because
   *  redacted vs unredacted payloads hash differently and the baseline would
   *  silently stop subtracting. Defaults to `true` (redacted), matching the CLI
   *  default. */
  redactSecrets?: boolean;
  /** Skip ALL baseline resolution (profile-declared file, policy-declared name,
   *  and the explicit override). For commands that use only the profile's
   *  handler-aware EXTRACTION and never subtract a baseline — `snapshot` (which
   *  CAPTURES the baseline a profile declares, so it must not require that file
   *  to already exist — the chicken-and-egg) and `drift` (raw snapshot-vs-live
   *  comparison). `ctx.baseline`, `planOptions.baseline`, and `baselineMeta` stay
   *  undefined. */
  skipBaseline?: boolean;
}

/** A profile resolved against a live source pool: a handler-aware extractor plus
 *  plan / prove / apply option bundles that all carry the same policy +
 *  capability + baseline. */
export interface ResolvedProfile {
  readonly id: string;
  /** The profile's extension handlers (exposed so a caller — e.g. `schema
   *  apply`'s shadow precheck — can inspect them without re-opening the profile). */
  readonly handlers: readonly ExtensionHandler[];
  /** Handler-aware extraction (core + this profile's handlers, same snapshot).
   *  A plain function field, not a method: callers pass it around by value
   *  (`ctx.extract ?? extract`), and it never relies on `this`. */
  readonly extract: (
    pool: Pool,
    options?: ExtractOptions,
  ) => Promise<ExtractResult>;
  /** Metadata of the baseline in effect (undefined when none), for stamping a
   *  plan artifact / export manifest and reconciling it at apply/prove time. */
  readonly baseline?: {
    readonly digest: string;
    readonly redactSecrets?: boolean;
    readonly path?: string;
  };
  readonly planOptions: PlanOptions;
  readonly proveOptions: ProveOptions;
  readonly applyOptions: ApplyOptions;
  /** Superuser-context (`pg_settings.context = 'superuser'`) GUC names, probed
   *  from the live connection. Present ONLY when the profile's policy declares
   *  `assumedSchemas` AND the connected role is NOT a superuser; consumed by
   *  `deriveAssumedSchemaSeed`'s `susetGucs` option to skip a co-located-shadow
   *  seed routine whose `SET <suset-guc>` header clause a non-superuser applier
   *  cannot REPLAY (Postgres validates proconfig at CREATE time against the
   *  creating role, SQLSTATE 42501). A superuser applier needs no stripping. */
  readonly susetGucs?: ReadonlySet<string>;
}

async function probePgMajor(pool: Pool): Promise<number> {
  const res = await pool.query(
    `SELECT current_setting('server_version_num')::int AS v`,
  );
  return Math.floor((res.rows[0] as { v: number }).v / 10000);
}

/**
 * Resolve a profile against the SOURCE pool: probe capability (if requested) and
 * the declared baseline (if any) once, then hand back option bundles whose
 * policy / capability / baseline are shared by reference across plan, prove, and
 * apply. Re-extraction for proof and the apply fingerprint gate is the SAME
 * handler-aware extractor, so the projected view never diverges.
 */
export async function resolveProfile(
  pool: Pool,
  profile: IntegrationProfile,
  options: ResolveProfileOptions = {},
): Promise<ResolvedProfile> {
  const { handlers, policy } = profile;

  const capability = options.restrictToApplier
    ? await probeApplierCapability(pool)
    : undefined;

  // Superuser-context (SUSET) GUCs: a real Supabase-Cloud `postgres` is a
  // privileged NON-superuser, so a seeded routine's `SET <suset-guc> TO …`
  // header clause (e.g. realtime.list_changes' `SET log_min_messages`) fails to
  // REPLAY (42501) when the co-located shadow's seed (`deriveAssumedSchemaSeed`)
  // is played back by that role — Postgres validates proconfig at CREATE time
  // against the creating role. The clause is never semantically compared (the
  // seeded routine re-extracts reference-only and cancels in the diff), so it is
  // safe to strip from the seed. Only relevant when the profile's policy
  // actually declares `assumedSchemas` (nothing to seed otherwise), and only
  // when the applier is NOT a superuser (a superuser needs no stripping — the
  // seed's routine replays as-is). Reuses the capability probed above when
  // `restrictToApplier` was requested; otherwise probes locally without
  // threading that probe into `planOptions`/`capability` (those stay governed
  // strictly by `restrictToApplier`). The `pool` this resolves against is the
  // same connection `schema apply` extracts the target from, which shares the
  // co-located shadow's cluster + role, so its GUC catalog and role are
  // authoritative for the shadow. Gated on the FLATTENED policy's
  // `assumedSchemas` (not the policy's own field) — a policy can inherit
  // `assumedSchemas` via `extends`, and `cmdSchemaApply` seeds from the
  // flattened set, so the probe must be gated on the same aggregate.
  let susetGucs: ReadonlySet<string> | undefined;
  if (policy !== undefined && flattenPolicy(policy).assumedSchemas.length > 0) {
    const applier = capability ?? (await probeApplierCapability(pool));
    if (!applier.isSuperuser) {
      const susetRows = await pool.query<{ name: string }>(
        `SELECT name FROM pg_settings WHERE context = 'superuser'`,
      );
      susetGucs = new Set(susetRows.rows.map((r) => r.name));
    }
  }

  // Baseline precedence: an explicit pre-loaded override (options.baseline) wins,
  // then a profile-declared file (baselinePath), then a policy-declared NAME
  // resolved against the committed baselines dir. Each yields a LoadedBaseline
  // carrying facts + digest + redaction mode. resolveBaseline only probes pgMajor
  // when the policy actually declares a baseline, so the common no-baseline path
  // pays nothing.
  let loaded: LoadedBaseline | undefined;
  if (options.skipBaseline) {
    loaded = undefined;
  } else if (options.baseline !== undefined) {
    loaded = options.baseline;
  } else if (profile.baselinePath !== undefined) {
    loaded = loadBaselineFile(profile.baselinePath);
  } else if (policy?.baseline !== undefined) {
    loaded = resolveBaseline(policy, {
      pgMajor: await probePgMajor(pool),
      ...(options.baselineDir !== undefined
        ? { dir: options.baselineDir }
        : {}),
    });
  }

  // Redaction guard: a baseline captured in a DIFFERENT redaction mode than this
  // command's extraction hashes its secret-bearing facts differently, so it would
  // silently stop subtracting them (the platform objects the operator asked to
  // hide would reappear). Fail loud instead. Default both sides to redacted.
  if (loaded !== undefined) {
    const baselineMode = loaded.redactSecrets ?? true;
    const commandMode = options.redactSecrets ?? true;
    if (baselineMode !== commandMode) {
      throw new Error(
        `baseline ${loaded.path ?? loaded.digest.slice(0, 12)} was captured with ` +
          `redactSecrets=${baselineMode}, but this command extracts with ` +
          `redactSecrets=${commandMode}; mismatched redaction makes baseline facts ` +
          `hash differently so the baseline would silently stop subtracting. ` +
          `Re-capture the baseline in the matching mode ` +
          `(pgdelta snapshot ${commandMode ? "" : "--unsafe-show-secrets "}--profile …).`,
      );
    }
  }

  // The engine option is a plain FactBase; the digest/redaction metadata travels
  // separately (planOptions.baselineMeta + ResolvedProfile.baseline).
  const baseline = loaded?.factBase;

  const profileExtract = async (
    p: Pool,
    extractOptions: ExtractOptions = {},
  ): Promise<ExtractResult> => {
    const result = await extract(p, { ...extractOptions, handlers });
    if (profile.id !== "supabase" && policy?.id !== "supabase") return result;
    return {
      ...result,
      diagnostics: await filterSupabasePlatformParameterAclDiagnostics(
        p,
        result.diagnostics,
      ),
    };
  };

  // fold the handlers' intent replay rules (pg_cron jobs, …) into a resolver
  // index. Only `plan()` needs it (prove never re-plans; apply only replays
  // artifact SQL), and it holds functions so it is NEVER serialized onto the
  // plan artifact — apply/prove reconstruct it from the same profile.
  const intentRules = buildIntentRuleIndex(handlers);

  // omit undefined keys: under exactOptionalPropertyTypes an explicit
  // `policy: undefined` is not assignable to an optional `policy?` field. The
  // SAME view-projection values are shared by reference across all three
  // bundles, so plan == prove == apply by construction.
  const view = {
    ...(policy !== undefined ? { policy } : {}),
    ...(capability !== undefined ? { capability } : {}),
    ...(baseline !== undefined ? { baseline } : {}),
  };

  // baseline metadata for artifact/manifest stamping + apply/prove reconciliation
  const baselineMeta =
    loaded !== undefined
      ? {
          digest: loaded.digest,
          ...(loaded.redactSecrets !== undefined
            ? { redactSecrets: loaded.redactSecrets }
            : {}),
          ...(loaded.path !== undefined ? { path: loaded.path } : {}),
        }
      : undefined;

  return {
    id: profile.id,
    handlers,
    extract: profileExtract,
    ...(baselineMeta !== undefined ? { baseline: baselineMeta } : {}),
    ...(susetGucs !== undefined ? { susetGucs } : {}),
    // stamp the profile id on planOptions so plan() records it on the artifact;
    // apply/prove then reconstruct this view without the operator repeating
    // --profile (P2 follow-up). baselineMeta stamps the baseline DIGEST on the
    // artifact so apply/prove fail loud on a swapped/edited baseline.
    planOptions: {
      ...view,
      profile: { id: profile.id },
      ...(loaded !== undefined
        ? { baselineMeta: { digest: loaded.digest } }
        : {}),
      ...(intentRules.size > 0 ? { intentRules } : {}),
    },
    proveOptions: { ...view, reextract: (p) => profileExtract(p) },
    applyOptions: {
      ...(baseline !== undefined ? { baseline } : {}),
      reextract: (p) => profileExtract(p),
    },
  };
}

/** The identity profile: no handlers, no policy — the raw view a generic user
 *  or a test sees. The default when no integration is selected. */
export const rawProfile: IntegrationProfile = {
  id: "raw",
  handlers: [],
};
