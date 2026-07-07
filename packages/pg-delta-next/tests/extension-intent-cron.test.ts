/**
 * Extension-intent Deliverable A3, end-to-end against a real pg_cron DB
 * (docs/architecture/extension-intent.md §3.2). Drives the public profile seam
 * (`resolveProfile`) the same way `profile-e2e-partman.test.ts` does for
 * pg_partman: a custom profile carrying ONLY `pgCronHandler` isolates the
 * cron-intent mechanism from the rest of `supabaseProfile`'s policy.
 *
 * pg_cron ships in the `supabase/postgres` image, not plain alpine, so this
 * gates behind `runSupabaseBareTests` / `PGDELTA_NEXT_SUPABASE_TESTS` exactly
 * like `extension-intent-partman.test.ts` and `profile-e2e-partman.test.ts`.
 *
 * UNLIKE every other extension-intent integration test, this file cannot use
 * `cluster.createDb(...)` isolated databases: pg_cron can only be installed
 * and scheduled from a SINGLE database per cluster (`cron.database_name`,
 * which defaults to `postgres`). Attempting `CREATE EXTENSION pg_cron` or
 * `cron.schedule(...)` on any other database fails with
 * "can only create extension in database postgres" / "Jobs must be scheduled
 * from the database configured in cron.database_name". So every scenario here
 * runs against the cluster's own `postgres` database (`cluster.adminPool`),
 * taking two snapshots in TIME (extract → mutate `cron.job` → extract)
 * instead of two snapshots in SPACE (two databases). Bun runs a file's tests
 * sequentially, so `afterEach` clearing `cron.job` gives each test a clean
 * slate despite sharing the one database.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { apply } from "../src/apply/apply.ts";
import { plan } from "../src/plan/plan.ts";
import {
  type IntegrationProfile,
  resolveProfile,
} from "../src/integrations/profile.ts";
import { pgCronHandler } from "../src/policy/extensions/index.ts";
import { runSupabaseBareTests, supabaseCluster } from "./containers.ts";

const cronProfile: IntegrationProfile = {
  id: "test-cron",
  handlers: [pgCronHandler],
};

describe.skipIf(!runSupabaseBareTests)(
  "extension-intent: pg_cron jobs (docs/architecture/extension-intent.md §3.2)",
  () => {
    afterEach(async () => {
      const cluster = await supabaseCluster();
      await cluster.adminPool.query(`DELETE FROM cron.job`);
    });

    test("create: a named job in the desired state plans a select cron.schedule(...) action, and applying it creates the job", async () => {
      const cluster = await supabaseCluster();
      const pool = cluster.adminPool;
      await pool.query(`CREATE EXTENSION IF NOT EXISTS pg_cron`);

      const ctx = await resolveProfile(pool, cronProfile);

      // SOURCE snapshot: no jobs yet.
      const sourceFb = (await ctx.extract(pool)).factBase;

      // DESIRED snapshot: the job exists.
      await pool.query(
        `SELECT cron.schedule('vac_create', '0 0 * * *', 'VACUUM')`,
      );
      const desiredFb = (await ctx.extract(pool)).factBase;

      const thePlan = plan(sourceFb, desiredFb, {
        ...ctx.planOptions,
        renames: "off",
      });

      const scheduleAction = thePlan.actions.find((a) =>
        /select cron\.schedule\('vac_create'/.test(a.sql),
      );
      expect(scheduleAction).toBeDefined();
      expect(scheduleAction?.verb).toBe("create");

      // reset the DB to exactly the SOURCE state before apply, so the
      // fingerprint gate (which re-extracts `pool` and compares against
      // `thePlan.source.fingerprint`) passes.
      await pool.query(`SELECT cron.unschedule('vac_create')`);

      const report = await apply(thePlan, pool, ctx.applyOptions);
      expect(report.status).toBe("applied");

      const { rows } = await pool.query<{ schedule: string }>(
        `SELECT schedule FROM cron.job WHERE jobname = 'vac_create'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.schedule).toBe("0 0 * * *");
    }, 180_000);

    test("edit: a schedule change plans unschedule before schedule, and applying it updates the job", async () => {
      const cluster = await supabaseCluster();
      const pool = cluster.adminPool;
      await pool.query(`CREATE EXTENSION IF NOT EXISTS pg_cron`);

      const ctx = await resolveProfile(pool, cronProfile);

      // SOURCE snapshot: the job with its original schedule.
      await pool.query(
        `SELECT cron.schedule('vac_edit', '0 0 * * *', 'VACUUM')`,
      );
      const sourceFb = (await ctx.extract(pool)).factBase;

      // DESIRED snapshot: the job with a new schedule.
      await pool.query(`SELECT cron.unschedule('vac_edit')`);
      await pool.query(
        `SELECT cron.schedule('vac_edit', '*/5 * * * *', 'VACUUM')`,
      );
      const desiredFb = (await ctx.extract(pool)).factBase;

      const thePlan = plan(sourceFb, desiredFb, {
        ...ctx.planOptions,
        renames: "off",
      });

      const unscheduleIdx = thePlan.actions.findIndex((a) =>
        /select cron\.unschedule\('vac_edit'\)/.test(a.sql),
      );
      const scheduleIdx = thePlan.actions.findIndex((a) =>
        /select cron\.schedule\('vac_edit', '\*\/5 \* \* \* \*'/.test(a.sql),
      );
      expect(unscheduleIdx).toBeGreaterThanOrEqual(0);
      expect(scheduleIdx).toBeGreaterThanOrEqual(0);
      expect(unscheduleIdx).toBeLessThan(scheduleIdx);

      // reset the DB to exactly the SOURCE state before apply.
      await pool.query(`SELECT cron.unschedule('vac_edit')`);
      await pool.query(
        `SELECT cron.schedule('vac_edit', '0 0 * * *', 'VACUUM')`,
      );

      const report = await apply(thePlan, pool, ctx.applyOptions);
      expect(report.status).toBe("applied");

      const { rows } = await pool.query<{ schedule: string }>(
        `SELECT schedule FROM cron.job WHERE jobname = 'vac_edit'`,
      );
      expect(rows[0]?.schedule).toBe("*/5 * * * *");
    }, 180_000);

    test("remove: a job absent from desired plans a cron.unschedule with no data loss, and applying it removes the job", async () => {
      const cluster = await supabaseCluster();
      const pool = cluster.adminPool;
      await pool.query(`CREATE EXTENSION IF NOT EXISTS pg_cron`);

      const ctx = await resolveProfile(pool, cronProfile);

      // SOURCE snapshot: the job exists.
      await pool.query(`SELECT cron.schedule('vac_rm', '0 0 * * *', 'VACUUM')`);
      const sourceFb = (await ctx.extract(pool)).factBase;

      // DESIRED snapshot: the job is gone.
      await pool.query(`SELECT cron.unschedule('vac_rm')`);
      const desiredFb = (await ctx.extract(pool)).factBase;

      const thePlan = plan(sourceFb, desiredFb, {
        ...ctx.planOptions,
        renames: "off",
      });

      const dropAction = thePlan.actions.find((a) =>
        /select cron\.unschedule\('vac_rm'\)/.test(a.sql),
      );
      expect(dropAction).toBeDefined();
      expect(dropAction?.verb).toBe("drop");
      expect(dropAction?.dataLoss).toBe("none");

      // reset the DB to exactly the SOURCE state before apply.
      await pool.query(`SELECT cron.schedule('vac_rm', '0 0 * * *', 'VACUUM')`);

      const report = await apply(thePlan, pool, ctx.applyOptions);
      expect(report.status).toBe("applied");

      const { rows } = await pool.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM cron.job WHERE jobname = 'vac_rm'`,
      );
      expect(rows[0]?.c).toBe(0);
    }, 180_000);

    test("convergence: re-extracting the applied DB and re-planning against the same desired state is a no-op", async () => {
      const cluster = await supabaseCluster();
      const pool = cluster.adminPool;
      await pool.query(`CREATE EXTENSION IF NOT EXISTS pg_cron`);

      const ctx = await resolveProfile(pool, cronProfile);

      // SOURCE snapshot: the job with its original schedule.
      await pool.query(
        `SELECT cron.schedule('vac_conv', '0 0 * * *', 'VACUUM')`,
      );
      const sourceFb = (await ctx.extract(pool)).factBase;

      // DESIRED snapshot: the job with a new schedule.
      await pool.query(`SELECT cron.unschedule('vac_conv')`);
      await pool.query(
        `SELECT cron.schedule('vac_conv', '*/5 * * * *', 'VACUUM')`,
      );
      const desiredFb = (await ctx.extract(pool)).factBase;

      const thePlan = plan(sourceFb, desiredFb, {
        ...ctx.planOptions,
        renames: "off",
      });

      // reset to SOURCE, then apply to reach DESIRED for real.
      await pool.query(`SELECT cron.unschedule('vac_conv')`);
      await pool.query(
        `SELECT cron.schedule('vac_conv', '0 0 * * *', 'VACUUM')`,
      );
      const report = await apply(thePlan, pool, ctx.applyOptions);
      expect(report.status).toBe("applied");

      // idempotence: applying the SAME desired state again against the
      // now-converged DB must be a no-op plan.
      const reappliedFb = (await ctx.extract(pool)).factBase;
      const secondPlan = plan(reappliedFb, desiredFb, {
        ...ctx.planOptions,
        renames: "off",
      });
      expect(secondPlan.actions.length).toBe(0);
    }, 180_000);

    test("an unnamed job in the desired state makes plan() throw the unkeyed error", async () => {
      const cluster = await supabaseCluster();
      const pool = cluster.adminPool;
      await pool.query(`CREATE EXTENSION IF NOT EXISTS pg_cron`);

      const ctx = await resolveProfile(pool, cronProfile);

      // SOURCE snapshot: clean, no jobs.
      const sourceFb = (await ctx.extract(pool)).factBase;

      // DESIRED snapshot: an unnamed row inserted directly, simulating the
      // legacy 2-arg cron.schedule path (which cron.schedule's 3-arg named
      // form can no longer produce).
      await pool.query(
        `INSERT INTO cron.job (jobname, schedule, command, nodename, nodeport, database, username, active)
         VALUES (NULL, '0 0 * * *', 'VACUUM', 'localhost', 5432, current_database(), 'postgres', true)`,
      );
      const desiredFb = (await ctx.extract(pool)).factBase;

      expect(() =>
        plan(sourceFb, desiredFb, { ...ctx.planOptions, renames: "off" }),
      ).toThrow(/cannot key|unnamed|no jobname/i);
    }, 180_000);
  },
);
