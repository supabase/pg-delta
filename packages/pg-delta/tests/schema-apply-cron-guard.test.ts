/**
 * pg_cron shadow precheck: `schema apply` must FAIL EARLY (before loading) when
 * the declarative dir contains pg_cron intent but the shadow database cannot
 * execute it — pg_cron's schedule* functions run only in the cluster's
 * `cron.database_name`, and a co-located shadow never is. Without the guard the
 * load reaches `cron.schedule_in_database(...)` and dies with a confusing
 * "function does not exist" stuck error.
 *
 * The INCAPABLE path needs no pg_cron in the image (it asserts its absence), so
 * this runs on the stock alpine shared cluster — no Supabase gate.
 *
 * Docker required.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdSchemaApply } from "../src/cli/commands/schema.ts";
import { sharedCluster } from "./containers.ts";

describe("schema apply: pg_cron shadow precheck", () => {
  test("cron intent into a non-cron shadow fails early with remediation", async () => {
    const cluster = await sharedCluster();
    const target = await cluster.createDb("cronguard_tgt");
    const work = mkdtempSync(join(tmpdir(), "pgdelta-cronguard-"));
    try {
      const dir = join(work, "schema");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "01_cron.sql"),
        `select cron.schedule_in_database('nightly', '0 0 * * *', 'SELECT 1', 'postgres', 'postgres', true);\n`,
      );
      // a custom profile with the pg_cron handler (so ctx.handlers carries the
      // shadow precheck); no --shadow → a co-located shadow on the alpine cluster
      // which has no pg_cron.
      const profilePath = join(work, "profile.json");
      writeFileSync(
        profilePath,
        JSON.stringify({ id: "cronmw", handlers: ["pg_cron"] }),
        "utf8",
      );

      let err: unknown;
      try {
        await cmdSchemaApply([
          "--dir",
          dir,
          "--target",
          target.uri,
          "--renames",
          "off",
          "--profile",
          profilePath,
        ]);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(Error);
      // the EARLY guard message — not a mid-load "function does not exist"
      expect((err as Error).message).toMatch(/pg_cron statements/);
      expect((err as Error).message).toMatch(
        /not available|not the cron database/,
      );
    } finally {
      await target.drop();
    }
  }, 90_000);
});
