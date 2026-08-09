/**
 * End-to-end through the REAL integration profile API (resolveProfile), proving
 * plan == apply against a pg_partman DB with operational children present
 * (review 2026-06-16, Phase 5 #1/#2).
 *
 * Unlike extension-intent-partman.test.ts (which hand-passes handlers), this
 * drives the public profile seam: ctx.extract / ctx.planOptions /
 * ctx.applyOptions. The headline guarantee is that apply's fingerprint gate
 * SUCCEEDS while partman children exist in the real target — the managed view is
 * reconstructed identically at plan and apply time.
 *
 * A custom profile carrying the pg_partman handler isolates the managed-view
 * MECHANISM. (That `supabaseProfile` bundles this handler is asserted by
 * src/public-api.test.ts; its policy's ownership scope is orthogonal here and is
 * unit-tested in src/policy/resolve-view.test.ts.)
 */
import { afterAll, describe, expect, test } from "bun:test";
import { apply } from "../src/apply/apply.ts";
import { plan } from "../src/plan/plan.ts";
import {
  type IntegrationProfile,
  resolveProfile,
} from "../src/integrations/profile.ts";
import { pgPartmanHandler } from "../src/policy/extensions/index.ts";
import { supabaseCluster, type TestDb } from "./containers.ts";

const partmanProfile: IntegrationProfile = {
  id: "test-partman",
  handlers: [pgPartmanHandler],
};

const dbs: TestDb[] = [];
afterAll(async () => {
  await Promise.all(dbs.map((d) => d.drop().catch(() => {})));
});

describe("integration profile end-to-end (pg_partman)", () => {
  test("plan/apply via resolveProfile: gate passes with managed children on the target", async () => {
    const cluster = await supabaseCluster();

    // SOURCE: parent + partman children + a seeded child row
    const source = await cluster.createDb("profile_e2e_src");
    dbs.push(source);
    await source.pool.query(`CREATE SCHEMA IF NOT EXISTS partman`);
    await source.pool.query(
      `CREATE EXTENSION IF NOT EXISTS pg_partman WITH SCHEMA partman`,
    );
    await source.pool.query(
      `CREATE TABLE public.events (
           id bigint GENERATED ALWAYS AS IDENTITY,
           created_at timestamptz NOT NULL
         ) PARTITION BY RANGE (created_at)`,
    );
    await source.pool.query(
      `SELECT partman.create_parent(
           p_parent_table := 'public.events',
           p_control := 'created_at',
           p_interval := '1 day')`,
    );
    await source.pool.query(
      `INSERT INTO public.events (created_at) VALUES (now())`,
    );

    // DESIRED: parent gains a column; no runtime children declared.
    const desired = await cluster.createDb("profile_e2e_dst");
    dbs.push(desired);
    await desired.pool.query(`CREATE SCHEMA IF NOT EXISTS partman`);
    await desired.pool.query(
      `CREATE EXTENSION IF NOT EXISTS pg_partman WITH SCHEMA partman`,
    );
    await desired.pool.query(
      `CREATE TABLE public.events (
           id bigint GENERATED ALWAYS AS IDENTITY,
           created_at timestamptz NOT NULL,
           note text
         ) PARTITION BY RANGE (created_at)`,
    );

    // Resolve the profile against the source (the apply target), then drive
    // extract / plan / apply through its option bundles — the public seam.
    const ctx = await resolveProfile(source.pool, partmanProfile);
    const sourceFb = (await ctx.extract(source.pool)).factBase;
    const desiredFb = (await ctx.extract(desired.pool)).factBase;
    const thePlan = plan(sourceFb, desiredFb, {
      ...ctx.planOptions,
      renames: "off",
    });

    // the plan does real work (add the column) but DROPs no partman child
    const dropsChild = thePlan.actions.some(
      (a) => a.verb === "drop" && /public\.events_/.test(a.sql),
    );
    expect(dropsChild).toBe(false);
    expect(thePlan.actions.some((a) => /add column/i.test(a.sql))).toBe(true);

    // apply to a sacrificial clone (children + seeded row present). The
    // fingerprint gate (ON) must reconstruct the SAME managed view — children
    // re-extracted handler-aware then projected out — and PASS.
    const clone = await source.clone();
    dbs.push(clone);
    const report = await apply(thePlan, clone.pool, ctx.applyOptions);

    expect(report.status).toBe("applied");
    // the seeded child row survived (managed partitions were never touched)
    const { rows } = await clone.pool.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM public.events`,
    );
    expect(rows[0]?.c).toBe(1);
  }, 240_000);
});
