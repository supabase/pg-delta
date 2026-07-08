/**
 * Profile-declared baseline, end-to-end (the platform middleware use case in
 * miniature). A custom profile file declares `"baseline": "./base.json"`; every
 * command that resolves the profile subtracts that baseline, so platform objects
 * captured in it are invisible to the managed view — WITHOUT a per-command
 * `--baseline` flag (removed) and WITHOUT a policy.
 *
 *  1. snapshot a "platform" database (schema `plat`) → a baseline file;
 *  2. add a user schema `app` to the same database;
 *  3. `schema export --profile <file>` (file declares the baseline) → the export
 *     contains only `app`, never `plat`, and the manifest records the baseline
 *     digest;
 *  4. `schema apply` of that export under a profile whose baseline digest differs
 *     fails loud (the P1 safety gate: a baselined export must not be applied
 *     against a different/absent baseline, or the omitted platform objects read
 *     as source-only drops).
 *
 * Docker required.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdSchemaApply, cmdSchemaExport } from "../src/cli/commands/schema.ts";
import { cmdSnapshot } from "../src/cli/commands/snapshot.ts";
import { readExportManifest } from "../src/frontends/export-manifest.ts";
import { sharedCluster } from "./containers.ts";

describe("profile-declared baseline (end-to-end)", () => {
  test("export subtracts the profile's baseline and stamps its digest; apply rejects a mismatched baseline", async () => {
    const cluster = await sharedCluster();
    const db = await cluster.createDb("profbase");
    const target = await cluster.createDb("profbase_tgt");
    const work = mkdtempSync(join(tmpdir(), "pgdelta-profbase-"));
    try {
      // 1. "platform" state, snapshot it as a baseline
      await db.pool.query(
        `CREATE SCHEMA plat; CREATE TABLE plat.t (id integer);`,
      );
      const baselinePath = join(work, "base.json");
      await cmdSnapshot(["--source", db.uri, "--out", baselinePath]);

      // 2. add user state on top of the platform baseline
      await db.pool.query(
        `CREATE SCHEMA app; CREATE TABLE app.u (id integer);`,
      );

      // 3. profile file declaring the baseline by a relative path
      const profilePath = join(work, "pgdelta-profile.json");
      writeFileSync(
        profilePath,
        JSON.stringify({ id: "mw", handlers: [], baseline: "./base.json" }),
        "utf8",
      );

      const outDir = join(work, "export");
      await cmdSchemaExport([
        "--source",
        db.uri,
        "--out-dir",
        outDir,
        "--profile",
        profilePath,
      ]);

      // the export contains the user schema and NOT the baselined platform schema
      const manifest = readExportManifest(outDir);
      expect(manifest?.baselineDigest).toBeDefined();
      const appFile = readFileSync(
        join(outDir, "schemas/app/schema.sql"),
        "utf8",
      );
      expect(appFile).toContain(`CREATE SCHEMA "app"`);
      expect(() =>
        readFileSync(join(outDir, "schemas/plat/schema.sql"), "utf8"),
      ).toThrow(); // plat was subtracted by the baseline → no file

      // 4. a profile whose baseline digest differs → apply fails loud. Build a
      // DIFFERENT baseline (empty target = different rootHash) and point a second
      // profile file at it.
      const otherBaseline = join(work, "other.json");
      await cmdSnapshot(["--source", target.uri, "--out", otherBaseline]);
      const mismatchProfile = join(work, "mismatch-profile.json");
      writeFileSync(
        mismatchProfile,
        JSON.stringify({ id: "mw", handlers: [], baseline: "./other.json" }),
        "utf8",
      );
      let applyError: unknown;
      try {
        await cmdSchemaApply([
          "--dir",
          outDir,
          "--target",
          target.uri,
          "--renames",
          "off",
          "--profile",
          mismatchProfile,
        ]);
      } catch (e) {
        applyError = e;
      }
      expect(applyError).toBeInstanceOf(Error);
      expect((applyError as Error).message).toMatch(/baseline mismatch/);
    } finally {
      await Promise.all([db.drop(), target.drop()]);
    }
  }, 120_000);

  test("snapshot --profile can CAPTURE the baseline its profile declares (chicken-and-egg)", async () => {
    const cluster = await sharedCluster();
    const db = await cluster.createDb("profbase_capture");
    const work = mkdtempSync(join(tmpdir(), "pgdelta-profbase-cap-"));
    try {
      await db.pool.query(
        `CREATE SCHEMA plat; CREATE TABLE plat.t (id integer);`,
      );
      // the profile DECLARES ./base.json, which does NOT exist yet — this is the
      // exact file the snapshot is about to write. It must not fail loading it.
      const profilePath = join(work, "pgdelta-profile.json");
      const baselinePath = join(work, "base.json");
      writeFileSync(
        profilePath,
        JSON.stringify({ id: "mw", handlers: [], baseline: "./base.json" }),
        "utf8",
      );
      expect(existsSync(baselinePath)).toBe(false);
      await cmdSnapshot([
        "--source",
        db.uri,
        "--out",
        baselinePath,
        "--profile",
        profilePath,
      ]);
      expect(existsSync(baselinePath)).toBe(true);
    } finally {
      await db.drop();
    }
  }, 120_000);
});
