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
  readExportManifest,
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
  test("round-trips the redaction mode and profile", () => {
    writeExportManifest(dir, { redactSecrets: false, profile: "supabase" });
    expect(readExportManifest(dir)).toEqual({
      redactSecrets: false,
      profile: "supabase",
    });
    writeExportManifest(dir, { redactSecrets: true });
    expect(readExportManifest(dir)).toEqual({ redactSecrets: true });
  });

  test("returns undefined when no manifest exists (older / hand-authored dir)", () => {
    expect(readExportManifest(dir)).toBeUndefined();
  });

  test("drops malformed / wrong-typed fields", () => {
    writeFileSync(join(dir, EXPORT_MANIFEST_FILE), "{ not json", "utf8");
    expect(readExportManifest(dir)).toBeUndefined();
    writeFileSync(
      join(dir, EXPORT_MANIFEST_FILE),
      `{"formatVersion":1,"redactSecrets":"yes","profile":3}`,
      "utf8",
    );
    expect(readExportManifest(dir)).toEqual({});
  });
});
