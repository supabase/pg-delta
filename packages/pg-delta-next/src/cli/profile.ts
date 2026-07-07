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
import type { Pool } from "pg";
import {
  type ExtensionHandler,
  type IntegrationProfile,
  pgCronHandler,
  pgPartmanHandler,
  rawProfile,
  type ResolvedProfile,
  type ResolveProfileOptions,
  resolveProfile,
  supabaseProfile,
} from "../integrations/index.ts";
import type { Policy } from "../policy/policy.ts";
import { UsageError } from "./flags.ts";

const PROFILES: Record<string, IntegrationProfile> = {
  raw: rawProfile,
  supabase: supabaseProfile,
};

/** The `--profile` value shown in usage strings. */
export const PROFILE_IDS = Object.keys(PROFILES).join(" | ");

/** The bundled extension handlers a custom profile file may reference BY NAME
 *  (the handler's `extension` field). Extend this as new handlers ship. */
const HANDLER_BY_NAME = new Map<string, ExtensionHandler>(
  ([pgPartmanHandler, pgCronHandler] as const).map((h) => [h.extension, h]),
);

/** A `--profile` value is a path (load from disk) rather than a built-in id when
 *  it looks like a path: contains a `/` or ends in `.json`. */
export function isProfilePath(id: string): boolean {
  return id.includes("/") || id.endsWith(".json");
}

/**
 * Parse a custom profile file's JSON into an `IntegrationProfile`. The file
 * mirrors `IntegrationProfile` but references handlers BY NAME (resolved against
 * {@link HANDLER_BY_NAME}) so it stays plain, serializable data:
 *
 *   { "id": "platform-middleware", "handlers": ["pg_partman", "pg_cron"],
 *     "policy"?: { ...a serializable Policy... } }
 *
 * `source` is the path/label used in error messages. Pure (no disk) so it is
 * unit-testable; {@link loadProfile} reads the file and delegates here.
 */
export function parseProfileFile(
  json: string,
  source: string,
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
  const handlers: ExtensionHandler[] = [];
  for (const name of obj["handlers"]) {
    if (typeof name !== "string") {
      throw new UsageError(
        `profile ${source}: handler names must be strings (got ${typeof name})`,
      );
    }
    const handler = HANDLER_BY_NAME.get(name);
    if (handler === undefined) {
      throw new UsageError(
        `profile ${source}: unknown handler '${name}' — available: ${[...HANDLER_BY_NAME.keys()].join(", ")}`,
      );
    }
    handlers.push(handler);
  }
  const policy = obj["policy"];
  return {
    id: obj["id"],
    handlers,
    ...(policy !== undefined && policy !== null
      ? { policy: policy as Policy }
      : {}),
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
  return parseProfileFile(json, path);
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
