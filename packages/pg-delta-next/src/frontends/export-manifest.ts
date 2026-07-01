/**
 * Redaction-mode manifest for a `schema export` directory.
 *
 * A directory export has no single artifact to stamp (unlike a plan or snapshot
 * JSON), so `schema export` drops this small sidecar recording whether secrets
 * were redacted. `schema apply --dir` reads it and re-extracts the shadow with
 * the SAME mode, so an unsafe export round-trips real FDW/user-mapping/
 * subscription credentials to the target without the operator having to re-pass
 * `--unsafe-show-secrets` (and a redacted export is not silently applied
 * unredacted). The file is a dotfile with a `.json` extension, so the SQL loader
 * (`collectSqlFiles`, `.sql` only) never treats it as declarative input and the
 * export pruner (`.sql` only) never removes it (PR #307 review P2).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const EXPORT_MANIFEST_FILE = ".pgdelta-export.json";

export function writeExportManifest(dir: string, redactSecrets: boolean): void {
  writeFileSync(
    join(dir, EXPORT_MANIFEST_FILE),
    `${JSON.stringify({ formatVersion: 1, redactSecrets }, null, 2)}\n`,
    "utf8",
  );
}

/**
 * The recorded redaction mode, or `undefined` when no readable manifest exists
 * (an export produced before this metadata, or a hand-authored directory).
 */
export function readExportManifestRedactSecrets(
  dir: string,
): boolean | undefined {
  try {
    const doc = JSON.parse(
      readFileSync(join(dir, EXPORT_MANIFEST_FILE), "utf8"),
    ) as { redactSecrets?: unknown };
    return typeof doc.redactSecrets === "boolean" ? doc.redactSecrets : undefined;
  } catch {
    return undefined;
  }
}
