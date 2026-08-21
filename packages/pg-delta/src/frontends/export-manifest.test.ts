/**
 * The export manifest records a directory export's redaction mode so
 * `schema apply --dir` re-extracts with the same mode (PR #307 review #3505088638).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyManifestLoadOrder,
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

  test("round-trips the owned files list (sorted POSIX relative paths)", () => {
    const files = ["cluster/roles.sql", "schemas/app/tables/t.sql"];
    writeExportManifest(dir, {
      redactSecrets: true,
      scope: "database",
      files,
    });
    expect(readExportManifest(dir)).toEqual({
      redactSecrets: true,
      scope: "database",
      files,
    });
  });

  test("round-trips loadOrder (emission order, not sorted)", () => {
    const loadOrder = ["schemas/app/tables/t.sql", "_cluster/publications.sql"];
    writeExportManifest(dir, {
      redactSecrets: true,
      scope: "database",
      files: ["_cluster/publications.sql", "schemas/app/tables/t.sql"],
      loadOrder,
    });
    expect(readExportManifest(dir)?.loadOrder).toEqual(loadOrder);
  });

  test("applyManifestLoadOrder uses loadOrder then leftover names in caller order", () => {
    const files = [
      { name: "_cluster/publications.sql", sql: "-- pub" },
      { name: "public/tables/t.sql", sql: "-- t" },
      { name: "extra.sql", sql: "-- extra" },
    ];
    expect(
      applyManifestLoadOrder(files, [
        "public/tables/t.sql",
        "_cluster/publications.sql",
      ]).map((f) => f.name),
    ).toEqual([
      "public/tables/t.sql",
      "_cluster/publications.sql",
      "extra.sql",
    ]);
    expect(applyManifestLoadOrder(files).map((f) => f.name)).toEqual(
      files.map((f) => f.name),
    );
  });

  test("drops a wrong-typed files field (non-array or non-string members)", () => {
    // A non-array value is dropped entirely.
    writeFileSync(
      join(dir, EXPORT_MANIFEST_FILE),
      `{"formatVersion":1,"redactSecrets":true,"files":"nope"}`,
      "utf8",
    );
    expect(readExportManifest(dir)).toEqual({ redactSecrets: true });

    // An array with a non-string member is dropped entirely.
    writeFileSync(
      join(dir, EXPORT_MANIFEST_FILE),
      `{"formatVersion":1,"redactSecrets":true,"files":["ok.sql",3]}`,
      "utf8",
    );
    expect(readExportManifest(dir)).toEqual({ redactSecrets: true });
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
