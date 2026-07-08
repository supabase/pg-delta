/**
 * Metadata manifest for a `schema export` directory.
 *
 * A directory export has no single artifact to stamp (unlike a plan or snapshot
 * JSON), so `schema export` drops this small sidecar recording:
 *   - the redaction mode, so `schema apply --dir` re-extracts the shadow with the
 *     SAME mode (an unsafe export round-trips real FDW/user-mapping/subscription
 *     credentials without re-passing `--unsafe-show-secrets`, and a redacted
 *     export is not silently applied unredacted);
 *   - the integration profile the export was projected with, so `schema apply`
 *     defaults to it — otherwise a `--profile supabase` export applied under the
 *     default (raw) profile would read the target's platform schemas/roles as
 *     drift and plan destructive drops.
 *
 * The file is a dotfile with a `.json` extension, so the SQL loader
 * (`collectSqlFiles`, `.sql` only) never treats it as declarative input and the
 * export pruner (`.sql` only) never removes it (PR #307 review P1/P2).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const EXPORT_MANIFEST_FILE = ".pgdelta-export.json";

export interface ExportManifest {
  /** whether secrets were redacted when the directory was exported */
  redactSecrets?: boolean;
  /** the integration profile id the export was projected with (e.g. "supabase") */
  profile?: string;
  /** the management scope the export was projected with. `database` omits
   *  cluster-global roles/memberships; `cluster` includes them. `schema apply`
   *  defaults to this and rejects a contradicting `--scope`. */
  scope?: "database" | "cluster";
  /** the DIGEST of the baseline subtracted when the directory was exported.
   *  `schema apply` reconciles the baseline it resolves against this and fails
   *  loud on a mismatch — so an export whose platform objects were omitted by a
   *  baseline can't be applied under a profile that no longer subtracts the same
   *  baseline (which would read those platform objects as source-only drops). */
  baselineDigest?: string;
}

export function writeExportManifest(
  dir: string,
  manifest: {
    redactSecrets: boolean;
    profile?: string;
    scope?: "database" | "cluster";
    baselineDigest?: string;
  },
): void {
  writeFileSync(
    join(dir, EXPORT_MANIFEST_FILE),
    `${JSON.stringify({ formatVersion: 1, ...manifest }, null, 2)}\n`,
    "utf8",
  );
}

/**
 * The recorded manifest, or `undefined` when no readable manifest exists (an
 * export produced before this metadata, or a hand-authored directory). Unknown
 * or wrong-typed fields are dropped.
 */
export function readExportManifest(dir: string): ExportManifest | undefined {
  const path = join(dir, EXPORT_MANIFEST_FILE);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    // Only a genuinely absent manifest is a soft fall-back (older export or a
    // hand-authored directory). A present-but-unreadable file must fail closed:
    // silently ignoring it would drop the recorded profile/scope/redaction mode
    // and plan a destructive apply against the target's real platform state.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(
      `cannot read export manifest ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `malformed export manifest ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const manifest: ExportManifest = {};
  if (typeof doc["redactSecrets"] === "boolean") {
    manifest.redactSecrets = doc["redactSecrets"];
  }
  if (typeof doc["profile"] === "string") {
    manifest.profile = doc["profile"];
  }
  if (doc["scope"] === "database" || doc["scope"] === "cluster") {
    manifest.scope = doc["scope"];
  }
  if (typeof doc["baselineDigest"] === "string") {
    manifest.baselineDigest = doc["baselineDigest"];
  }
  return manifest;
}
