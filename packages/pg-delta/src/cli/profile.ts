/**
 * CLI profile selection (`--profile <id>`).
 *
 * One flag is the safe, discoverable way to opt into integration semantics:
 * `--profile supabase` composes handler-aware extraction, the Supabase policy,
 * baseline resolution, proof re-extraction, and apply fingerprint reconstruction
 * — instead of asking the operator to hand-assemble that recipe. `raw` (the
 * default) is the unrestricted view for generic users and tests.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Pool } from "pg";
import {
  type ExtensionHandler,
  type IntegrationProfile,
  makePgCronHandler,
  pgPartmanHandler,
  rawProfile,
  type ResolvedProfile,
  type ResolveProfileOptions,
  resolveProfile,
  supabaseProfile,
} from "../integrations/index.ts";
import { flattenPolicy, type Policy } from "../policy/policy.ts";
import { UsageError } from "./flags.ts";

const PROFILES: Record<string, IntegrationProfile> = {
  raw: rawProfile,
  supabase: supabaseProfile,
};

/** The `--profile` value shown in usage strings. */
export const PROFILE_IDS = Object.keys(PROFILES).join(" | ");

/**
 * The bundled extension handlers a custom profile file may reference BY NAME
 * (the handler's `extension` field), as FACTORIES taking the profile file's own
 * declared policy. Extend this as new handlers ship.
 *
 * A factory (rather than a ready-made instance) is what lets a CONFIGURABLE
 * handler read the same file's `policy`: `pg_cron` derives its `defaultJobOwner`
 * from the policy's EFFECTIVE (flattened) `defaultOwner` — the role the profile
 * already declares as the owner/executor, including one inherited through
 * `Policy.extends` — so a profile file gets the same non-superuser-applyable
 * username elision the built-in Supabase profile gets. Platform-history knobs
 * (e.g. Supabase's `supabase_read_only_user` owner alias) are NOT derivable from
 * a policy and stay in `src/integrations/supabase.ts`.
 *
 * Takes the already-resolved default owner (not the raw `Policy`) so callers
 * run `flattenPolicy` exactly ONCE per profile file, not once per handler.
 */
const HANDLER_FACTORY_BY_NAME = new Map<
  string,
  (resolvedDefaultOwner: string | undefined) => ExtensionHandler
>([
  [pgPartmanHandler.extension, () => pgPartmanHandler],
  [
    "pg_cron",
    (resolvedDefaultOwner) =>
      makePgCronHandler(
        resolvedDefaultOwner !== undefined
          ? { defaultJobOwner: resolvedDefaultOwner }
          : {},
      ),
  ],
]);

/** A `--profile` value is a path (load from disk) rather than a built-in id when
 *  it looks like a path: contains a `/` or ends in `.json`. */
export function isProfilePath(id: string): boolean {
  return id.includes("/") || id.endsWith(".json");
}

/**
 * Parse a custom profile file's JSON into an `IntegrationProfile`. The file
 * mirrors `IntegrationProfile` but references handlers BY NAME (resolved against
 * {@link HANDLER_FACTORY_BY_NAME}) so it stays plain, serializable data:
 *
 *   { "id": "platform-middleware", "handlers": ["pg_partman", "pg_cron"],
 *     "policy"?: { ...a serializable Policy... },
 *     "baseline"?: "./middleware-base.json" }
 *
 * The declared `policy` also CONFIGURES the named handlers (a `pg_cron` handler
 * takes its default job owner from `policy.defaultOwner`), so it is parsed first.
 *
 * `baseline` is a path to a `pgdelta snapshot` file; a relative path is resolved
 * against `opts.dir` (the profile file's own directory) so a committed profile +
 * baseline pair is portable. `source` is the path/label used in error messages.
 * Pure (no disk) so it is unit-testable; {@link loadProfile} reads the file,
 * passes its directory as `opts.dir`, and delegates here.
 */
export function parseProfileFile(
  json: string,
  source: string,
  opts: { dir?: string } = {},
): IntegrationProfile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new UsageError(
      `profile ${source}: not valid JSON — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new UsageError(`profile ${source}: expected a JSON object`);
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj["id"] !== "string" || obj["id"] === "") {
    throw new UsageError(`profile ${source}: missing a non-empty string "id"`);
  }
  if (!Array.isArray(obj["handlers"])) {
    throw new UsageError(
      `profile ${source}: "handlers" must be an array of handler names`,
    );
  }
  // the policy is read BEFORE the handlers because a handler factory is
  // configured from it (see HANDLER_FACTORY_BY_NAME).
  const rawPolicy = obj["policy"];
  const policy =
    rawPolicy !== undefined && rawPolicy !== null
      ? (rawPolicy as Policy)
      : undefined;
  // Resolve the EFFECTIVE default owner through flattenPolicy exactly ONCE per
  // profile file, not once per handler: `Policy.extends` composes inline
  // nested policies, and `defaultOwner` inherits from the first parent that
  // declares one when the policy itself doesn't (see flattenPolicy's
  // scalar-inheritance contract) — reading `policy.defaultOwner` directly
  // would miss that inherited value. The profile file's policy is an
  // unvalidated blind cast, so flattenPolicy's cycle guard can throw; surface
  // that as a UsageError instead of an unhandled Error.
  let resolvedDefaultOwner: string | undefined;
  if (policy !== undefined) {
    try {
      resolvedDefaultOwner = flattenPolicy(policy).defaultOwner;
    } catch (err) {
      throw new UsageError(
        `profile ${source}: invalid policy — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  const handlers: ExtensionHandler[] = [];
  for (const name of obj["handlers"]) {
    if (typeof name !== "string") {
      throw new UsageError(
        `profile ${source}: handler names must be strings (got ${typeof name})`,
      );
    }
    const makeHandler = HANDLER_FACTORY_BY_NAME.get(name);
    if (makeHandler === undefined) {
      throw new UsageError(
        `profile ${source}: unknown handler '${name}' — available: ${[...HANDLER_FACTORY_BY_NAME.keys()].join(", ")}`,
      );
    }
    handlers.push(makeHandler(resolvedDefaultOwner));
  }
  const rawBaseline = obj["baseline"];
  if (
    rawBaseline !== undefined &&
    (typeof rawBaseline !== "string" || rawBaseline === "")
  ) {
    throw new UsageError(
      `profile ${source}: "baseline" must be a non-empty string path to a snapshot file`,
    );
  }
  // resolve a relative baseline path against the profile file's own directory so
  // a committed profile + baseline pair is portable; an absolute path is kept.
  const baselinePath =
    typeof rawBaseline === "string"
      ? opts.dir !== undefined
        ? resolve(opts.dir, rawBaseline)
        : rawBaseline
      : undefined;
  return {
    id: obj["id"],
    handlers,
    ...(policy !== undefined ? { policy } : {}),
    ...(baselinePath !== undefined ? { baselinePath } : {}),
  };
}

/** Read and parse a custom profile file from disk. */
export function loadProfile(path: string): IntegrationProfile {
  let json: string;
  try {
    json = readFileSync(path, "utf8");
  } catch (err) {
    throw new UsageError(
      `profile ${path}: cannot read file — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return parseProfileFile(json, path, { dir: dirname(path) });
}

/** Map a `--profile` value to its profile: a built-in id (`raw`/`supabase`,
 *  default `raw`), or a path to a custom profile `.json` file. Throws
 *  UsageError otherwise. */
export function profileById(id: string | undefined): IntegrationProfile {
  if (id !== undefined && isProfilePath(id)) return loadProfile(id);
  const profile = PROFILES[id ?? "raw"];
  if (profile === undefined) {
    throw new UsageError(
      `--profile must be one of: ${PROFILE_IDS} (or a path to a profile .json) (got: ${id})`,
    );
  }
  return profile;
}

/** Resolve the selected profile against a live pool (source / target / clone). */
export function resolveCliProfile(
  pool: Pool,
  id: string | undefined,
  options?: ResolveProfileOptions,
): Promise<ResolvedProfile> {
  return resolveProfile(pool, profileById(id), options);
}

/**
 * Reconcile the baseline DIGEST stamped on a produced artifact (plan artifact /
 * export manifest) against the digest the current command resolved from its
 * profile. Throws a UsageError on ANY asymmetry:
 *   - both present but different → a swapped or edited baseline;
 *   - stamped but the command resolved none → the profile no longer declares the
 *     baseline the artifact was produced with;
 *   - the command resolved one but the artifact carries none → the profile now
 *     declares a baseline the artifact was NOT produced with.
 *
 * This turns the fingerprint gate's opaque "re-plan" into a precise diagnosis and
 * enforces the plan == prove == apply invariant for profile-file baselines (which
 * carry no policy-declared NAME the older name-based guard could check). `context`
 * names the artifact for the message (e.g. "plan artifact", "export manifest").
 */
export function reconcileBaselineDigest(
  stamped: string | undefined,
  resolved: string | undefined,
  context: string,
): void {
  if (stamped === resolved) return;
  if (stamped !== undefined && resolved !== undefined) {
    throw new UsageError(
      `baseline mismatch: the ${context} was produced with baseline digest ${stamped.slice(0, 12)} ` +
        `but the profile now resolves to ${resolved.slice(0, 12)}. The baseline changed since the ` +
        `${context} was produced — regenerate it, or point the profile back at the original baseline.`,
    );
  }
  if (stamped !== undefined) {
    throw new UsageError(
      `baseline mismatch: the ${context} was produced with baseline digest ${stamped.slice(0, 12)} ` +
        `but the profile now declares NO baseline. Restore the profile's baseline, or regenerate the ${context}.`,
    );
  }
  throw new UsageError(
    `baseline mismatch: the profile declares a baseline (digest ${resolved?.slice(0, 12)}) but the ${context} ` +
      `was produced with NONE. Regenerate the ${context} with this profile, or remove the profile's baseline.`,
  );
}

/**
 * Reconcile the `--profile` flag with the profile id stamped on a plan artifact
 * (apply/prove). The apply/prove profile MUST match the plan's, so:
 *
 * - `--profile` omitted → use the plan's stamped id (or undefined → raw when the
 *   plan carries no profile, i.e. it came from a direct library `plan()` call
 *   with no integration);
 * - `--profile` given → use it, but throw if it contradicts the plan's stamp.
 *
 * The returned id is fed to {@link resolveCliProfile} / {@link profileById},
 * which rejects an id unknown to this binary.
 */
export function effectiveProfileId(
  flagId: string | undefined,
  planProfileId: string | undefined,
): string | undefined {
  // a file-path flag stamps its DECLARED id on the plan, so reconcile against
  // that id (load the file), not the raw path string. The returned value stays
  // the path so profileById can load it. (A file profile's plan can only be
  // apply/prove-d by passing --profile <same path>: the artifact stamps the id,
  // not the file location, so an omitted flag cannot recover the file.)
  const flagComparisonId =
    flagId !== undefined && isProfilePath(flagId)
      ? loadProfile(flagId).id
      : flagId;
  if (
    flagComparisonId !== undefined &&
    planProfileId !== undefined &&
    flagComparisonId !== planProfileId
  ) {
    throw new UsageError(
      `--profile ${flagId} (id "${flagComparisonId}") does not match the plan's profile "${planProfileId}"; ` +
        `the apply/prove profile must match the plan profile — omit --profile to use the plan's, ` +
        `or re-plan with --profile ${flagId}`,
    );
  }
  return flagId ?? planProfileId;
}

/**
 * Reconcile the `--profile` flag with the profile id STAMPED on a snapshot (the
 * `drift` snapshot, or `prove`'s desired snapshot). A snapshot must be compared
 * under the profile it was CAPTURED with, or the live re-extract runs different
 * handlers than the snapshot's facts were produced with (handler-aware facts
 * would read as spurious drift). Mirrors {@link effectiveProfileId} but for the
 * snapshot's three-state stamp:
 *
 * - `--profile` omitted → adopt the stamp (a `null` stamp = captured raw →
 *   resolves as the concrete `"raw"` profile);
 * - `--profile` given → use it, but throw if it contradicts the stamp. A `null`
 *   (captured-raw) stamp DOES contradict a non-raw `--profile` — it is treated
 *   as `"raw"`, not collapsed to "no stamp";
 * - an ABSENT (`undefined`) stamp is a pre-stamping legacy snapshot → the flag
 *   wins with no contradiction (the caller may note the snapshot predates
 *   stamping when the flag is omitted too).
 */
export function reconcileSnapshotProfile(
  flagId: string | undefined,
  stamped: string | null | undefined,
): string | undefined {
  // legacy snapshot (pre-stamping): no reconciliation — the flag wins.
  if (stamped === undefined) return flagId;
  // captured-raw (null) reconciles as the concrete "raw" profile so a
  // contradicting --profile fails closed rather than slipping through.
  const stampedId = stamped === null ? "raw" : stamped;
  // a file-path flag stamps its DECLARED id on the snapshot, so reconcile
  // against that id (load the file), not the raw path string.
  const flagComparisonId =
    flagId !== undefined && isProfilePath(flagId)
      ? loadProfile(flagId).id
      : flagId;
  if (flagComparisonId !== undefined && flagComparisonId !== stampedId) {
    throw new UsageError(
      `--profile ${flagId} (id "${flagComparisonId}") does not match the snapshot's captured profile "${stampedId}"; ` +
        `a snapshot must be compared under the profile it was captured with — omit --profile to use the snapshot's, ` +
        `or re-capture the snapshot with --profile ${flagId}`,
    );
  }
  return flagId ?? stampedId;
}
