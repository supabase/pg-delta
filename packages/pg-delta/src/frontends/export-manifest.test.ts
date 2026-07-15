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
  test("round-trips the redaction mode, profile, and scope", () => {
    writeExportManifest(dir, {
      redactSecrets: false,
      profile: "supabase",
      scope: "cluster",
    });
    expect(readExportManifest(dir)).toEqual({
      redactSecrets: false,
      profile: "supabase",
      scope: "cluster",
    });
    writeExportManifest(dir, { redactSecrets: true, scope: "database" });
    expect(readExportManifest(dir)).toEqual({
      redactSecrets: true,
      scope: "database",
    });
  });

  test("round-trips defaultOwner as a role name, null (verbose), or absent", () => {
    writeExportManifest(dir, {
      redactSecrets: true,
      scope: "database",
      defaultOwner: "postgres",
    });
    expect(readExportManifest(dir)).toEqual({
      redactSecrets: true,
      scope: "database",
      defaultOwner: "postgres",
    });

    // null (verbose export) is a recorded value distinct from absent.
    writeExportManifest(dir, {
      redactSecrets: true,
      scope: "database",
      defaultOwner: null,
    });
    expect(readExportManifest(dir)).toEqual({
      redactSecrets: true,
      scope: "database",
      defaultOwner: null,
    });

    // absent (pre-feature / cluster-scope export): field simply not present.
    writeExportManifest(dir, { redactSecrets: true, scope: "cluster" });
    const read = readExportManifest(dir);
    expect(read).toEqual({ redactSecrets: true, scope: "cluster" });
    expect("defaultOwner" in (read as object)).toBe(false);
  });

  test("returns undefined when no manifest exists (older / hand-authored dir)", () => {
    expect(readExportManifest(dir)).toBeUndefined();
  });

  test("throws on a present-but-unparseable manifest (fail closed)", () => {
    // A corrupt manifest must abort before planning, not silently fall back to
    // raw defaults — that would drop the recorded profile/scope/redaction mode
    // and plan a destructive apply against the target's real platform state.
    writeFileSync(join(dir, EXPORT_MANIFEST_FILE), "{ not json", "utf8");
    expect(() => readExportManifest(dir)).toThrow();
  });

  test("drops wrong-typed fields from a valid manifest", () => {
    // Valid JSON with unknown / wrong-typed fields is not "malformed": parse it
    // and drop the bad fields (a forward-compatible manifest still applies).
    writeFileSync(
      join(dir, EXPORT_MANIFEST_FILE),
      `{"formatVersion":1,"redactSecrets":"yes","profile":3}`,
      "utf8",
    );
    expect(readExportManifest(dir)).toEqual({});
  });
});
