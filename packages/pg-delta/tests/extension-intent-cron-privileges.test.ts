/**
 * pg_cron job replay must be applyable by the NON-SUPERUSER executor a real
 * Supabase project hands out (`postgres`), not just by the platform-internal
 * `supabase_admin`.
 *
 * pg_cron's `cron.schedule_in_database(..., username, ...)` requires SUPERUSER
 * whenever the `username` argument is non-NULL — even when it names the calling
 * role itself. Passing `NULL` means "current_user" and needs no privilege. So a
 * plan that replays a `postgres`-owned job with an explicit `'postgres'`
 * username literal is unapplyable on a hosted project:
 *
 *     ERROR: must be superuser to create a job for another role
 *
 * Every OTHER cron integration test (`extension-intent-cron.test.ts`) drives the
 * shared cluster's `adminPool`, which connects as `supabase_admin` — a genuine
 * superuser — so none of them can see this. This file therefore uses
 * `startStandaloneSupabase()`, whose `postgres` role is deliberately reshaped
 * into a NON-superuser member of `supabase_privileged_role`, exactly like
 * Supabase Cloud, and executes the planned SQL over `postgresConnectionUri()`.
 *
 * pg_cron only works in the cluster's `cron.database_name` (default `postgres`),
 * so everything here runs against that one database; extraction/planning still
 * goes through the admin connection (that is the platform's own extraction
 * identity) while APPLY is deliberately the non-superuser one.
 *
 * Gated behind `PGDELTA_NEXT_SUPABASE_TESTS` like every other Supabase-image
 * test (pg_cron is absent from stock `postgres:*-alpine`).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import pg from "pg";
import { plan } from "../src/plan/plan.ts";
import {
  type IntegrationProfile,
  resolveProfile,
} from "../src/integrations/profile.ts";
import { SUPABASE_EXTENSION_HANDLERS } from "../src/integrations/supabase.ts";
import {
  runSupabaseBareTests,
  startStandaloneSupabase,
  type StartedStandaloneSupabase,
} from "./containers.ts";

/** The pg_cron handler AS THE SUPABASE PROFILE COMPOSES IT — the elision is a
 *  property of that composition (the profile declares the default job owner),
 *  not of the bare, platform-neutral handler. Isolating it in a minimal profile
 *  keeps the test about the cron mechanism, not the whole Supabase policy. */
const supabaseCronHandler = SUPABASE_EXTENSION_HANDLERS.find(
  (h) => h.extension === "pg_cron",
);

const cronProfile: IntegrationProfile = {
  id: "test-cron-privileges",
  handlers: supabaseCronHandler === undefined ? [] : [supabaseCronHandler],
};

describe.skipIf(!runSupabaseBareTests)(
  "extension-intent: pg_cron job replay as a non-superuser executor",
  () => {
    let container: StartedStandaloneSupabase;
    let adminPool: pg.Pool;
    let userPool: pg.Pool;

    beforeAll(async () => {
      container = await startStandaloneSupabase();
      adminPool = new pg.Pool({
        connectionString: container.connectionUri(),
        max: 1,
      });
      adminPool.on("error", () => {});
      userPool = new pg.Pool({
        connectionString: container.postgresConnectionUri(),
        max: 1,
      });
      userPool.on("error", () => {});

      await adminPool.query(`CREATE EXTENSION IF NOT EXISTS pg_cron`);
      // the documented Supabase enablement step — `postgres` manages its own
      // jobs through the `cron` schema.
      await adminPool.query(`GRANT USAGE ON SCHEMA cron TO postgres`);
    }, 300_000);

    afterAll(async () => {
      await adminPool?.end().catch(() => {});
      await userPool?.end().catch(() => {});
      await container?.stop().catch(() => {});
    });

    test("the profile's cron handler is present", () => {
      expect(supabaseCronHandler).toBeDefined();
    });

    test("`postgres` is a NON-superuser (the whole point of this file)", async () => {
      const { rows } = await userPool.query<{
        rolsuper: boolean;
        me: string;
      }>(
        `SELECT rolsuper, current_user AS me FROM pg_roles WHERE rolname = current_user`,
      );
      expect(rows[0]?.me).toBe("postgres");
      expect(rows[0]?.rolsuper).toBe(false);
    });

    test("a postgres-owned job's planned replay applies as the non-superuser postgres role and converges", async () => {
      const ctx = await resolveProfile(adminPool, cronProfile);

      // SOURCE snapshot: no such job.
      const sourceFb = (await ctx.extract(adminPool)).factBase;

      // DESIRED snapshot: a job created BY `postgres` itself, so its
      // `cron.job.username` is `postgres` — the ordinary hosted-project shape.
      await userPool.query(
        `SELECT cron.schedule('pgdelta_np_replay', '0 0 * * *', 'select 1')`,
      );
      const desiredFb = (await ctx.extract(adminPool)).factBase;

      const thePlan = plan(sourceFb, desiredFb, {
        ...ctx.planOptions,
        renames: "off",
      });

      const scheduleAction = thePlan.actions.find((a) =>
        /select cron\.schedule_in_database\('pgdelta_np_replay'/.test(a.sql),
      );
      expect(scheduleAction).toBeDefined();

      // reset to SOURCE: `postgres` owns the job, so it can unschedule it.
      await userPool.query(`SELECT cron.unschedule('pgdelta_np_replay')`);

      // THE REGRESSION: execute the planned replay as the non-superuser
      // `postgres` — exactly what `pgdelta apply`/the CLI loader does against a
      // hosted project. With an explicit username literal pg_cron rejects this
      // with "must be superuser to create a job for another role".
      await userPool.query(scheduleAction?.sql as string);

      // the job exists, owned by postgres…
      const { rows } = await adminPool.query<{
        username: string;
        schedule: string;
        active: boolean;
      }>(
        `SELECT username, schedule, active FROM cron.job WHERE jobname = 'pgdelta_np_replay'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.username).toBe("postgres");
      expect(rows[0]?.schedule).toBe("0 0 * * *");
      expect(rows[0]?.active).toBe(true);

      // …and re-planning against the same desired state is a no-op, so the
      // elided username still converges on the captured fact.
      const reappliedFb = (await ctx.extract(adminPool)).factBase;
      const secondPlan = plan(reappliedFb, desiredFb, {
        ...ctx.planOptions,
        renames: "off",
      });
      expect(secondPlan.actions.length).toBe(0);

      await userPool.query(`SELECT cron.unschedule('pgdelta_np_replay')`);
    }, 300_000);

    test("an INACTIVE postgres-owned job also replays as the non-superuser role", async () => {
      const ctx = await resolveProfile(adminPool, cronProfile);

      const sourceFb = (await ctx.extract(adminPool)).factBase;

      // the shape pg-delta's own export produces for a paused job — the 6-arg
      // form is unavoidable here (the 3-arg one always creates active jobs), so
      // it must stay applyable by a non-superuser.
      await userPool.query(
        `SELECT cron.schedule_in_database('pgdelta_np_inactive', '0 0 * * *', 'select 1', current_database(), NULL, false)`,
      );
      const desiredFb = (await ctx.extract(adminPool)).factBase;

      const thePlan = plan(sourceFb, desiredFb, {
        ...ctx.planOptions,
        renames: "off",
      });
      const scheduleAction = thePlan.actions.find((a) =>
        /select cron\.schedule_in_database\('pgdelta_np_inactive'/.test(a.sql),
      );
      expect(scheduleAction).toBeDefined();

      await adminPool.query(
        `DELETE FROM cron.job WHERE jobname = 'pgdelta_np_inactive'`,
      );

      await userPool.query(scheduleAction?.sql as string);

      const { rows } = await adminPool.query<{
        username: string;
        active: boolean;
      }>(
        `SELECT username, active FROM cron.job WHERE jobname = 'pgdelta_np_inactive'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.username).toBe("postgres");
      expect(rows[0]?.active).toBe(false);

      await adminPool.query(
        `DELETE FROM cron.job WHERE jobname = 'pgdelta_np_inactive'`,
      );
    }, 300_000);
  },
);
