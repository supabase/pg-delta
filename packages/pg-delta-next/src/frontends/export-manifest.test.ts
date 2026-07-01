/**
 * The export manifest records a directory export's redaction mode so
 * `schema apply --dir` re-extracts with the same mode (PR #307 review #3505088638).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EXPORT_MANIFEST_FILE,
  readExportManifestRedactSecrets,
  writeExportManifest,
} from "./export-manifest.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pgdn-manifest-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("export manifest", () => {
  test("round-trips the redaction mode", () => {
    writeExportManifest(dir, false);
    expect(readExportManifestRedactSecrets(dir)).toBe(false);
    writeExportManifest(dir, true);
    expect(readExportManifestRedactSecrets(dir)).toBe(true);
  });

  test("returns undefined when no manifest exists (older / hand-authored dir)", () => {
    expect(readExportManifestRedactSecrets(dir)).toBeUndefined();
  });

  test("returns undefined for a malformed or fieldless manifest", () => {
    writeFileSync(join(dir, EXPORT_MANIFEST_FILE), "{ not json", "utf8");
    expect(readExportManifestRedactSecrets(dir)).toBeUndefined();
    writeFileSync(
      join(dir, EXPORT_MANIFEST_FILE),
      `{"formatVersion":1}`,
      "utf8",
    );
    expect(readExportManifestRedactSecrets(dir)).toBeUndefined();
  });
});
