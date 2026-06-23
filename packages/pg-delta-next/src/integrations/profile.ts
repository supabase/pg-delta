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
import type { ProveOptions } from "../proof/prove.ts";
import { resolveBaseline } from "../policy/baseline.ts";
import { probeApplierCapability } from "../policy/capability.ts";
import type { Policy } from "../policy/policy.ts";

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
}

export interface ResolveProfileOptions {
  /** Probe the source pool's applier capability and restrict the managed view to
   *  operations that applier can execute (e.g. drop superuser-only FDW ACLs). */
  restrictToApplier?: boolean;
  /** Directory to resolve a policy's declared baseline snapshot from (defaults
   *  to the committed `src/policy/baselines/`). */
  baselineDir?: string;
}

/** A profile resolved against a live source pool: a handler-aware extractor plus
 *  plan / prove / apply option bundles that all carry the same policy +
 *  capability + baseline. */
export interface ResolvedProfile {
  readonly id: string;
  /** Handler-aware extraction (core + this profile's handlers, same snapshot).
   *  A plain function field, not a method: callers pass it around by value
   *  (`ctx.extract ?? extract`), and it never relies on `this`. */
  readonly extract: (
    pool: Pool,
    options?: ExtractOptions,
  ) => Promise<ExtractResult>;
  readonly planOptions: PlanOptions;
  readonly proveOptions: ProveOptions;
  readonly applyOptions: ApplyOptions;
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

  // resolveBaseline returns undefined immediately when the policy declares no
  // baseline, so we only pay for the pgMajor probe when one is actually needed.
  const baseline =
    policy?.baseline !== undefined
      ? resolveBaseline(policy, {
          pgMajor: await probePgMajor(pool),
          ...(options.baselineDir !== undefined
            ? { dir: options.baselineDir }
            : {}),
        })
      : undefined;

  const profileExtract = (
    p: Pool,
    extractOptions: ExtractOptions = {},
  ): Promise<ExtractResult> => extract(p, { ...extractOptions, handlers });

  // omit undefined keys: under exactOptionalPropertyTypes an explicit
  // `policy: undefined` is not assignable to an optional `policy?` field. The
  // SAME view-projection values are shared by reference across all three
  // bundles, so plan == prove == apply by construction.
  const view = {
    ...(policy !== undefined ? { policy } : {}),
    ...(capability !== undefined ? { capability } : {}),
    ...(baseline !== undefined ? { baseline } : {}),
  };

  return {
    id: profile.id,
    extract: profileExtract,
    // stamp the profile id on planOptions so plan() records it on the artifact;
    // apply/prove then reconstruct this view without the operator repeating
    // --profile (P2 follow-up).
    planOptions: { ...view, profile: { id: profile.id } },
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
