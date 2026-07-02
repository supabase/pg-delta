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
}

export function writeExportManifest(
  dir: string,
  manifest: {
    redactSecrets: boolean;
    profile?: string;
    scope?: "database" | "cluster";
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
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(
      readFileSync(join(dir, EXPORT_MANIFEST_FILE), "utf8"),
    ) as Record<string, unknown>;
  } catch {
    return undefined;
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
  return manifest;
}
