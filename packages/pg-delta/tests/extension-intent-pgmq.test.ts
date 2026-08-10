/**
 * Extension-intent for pgmq, end-to-end against a real pgmq database (CLI-2054,
 * docs/architecture/extension-intent.md §4.1). Drives the public profile seam
 * (`resolveProfile`) exactly like `extension-intent-cron.test.ts`: a custom
 * profile carrying ONLY `pgmqHandler` isolates the queue-intent mechanism from
 * the rest of `supabaseProfile`'s policy (which excludes the whole `pgmq`
 * schema anyway, so it could never show that the HANDLER is what keeps the
 * operational tables out of the diff).
 *
 * pgmq ships in the `supabase/postgres` image, not plain alpine, so this gates
 * behind `runSupabaseBareTests` / `PGDELTA_NEXT_SUPABASE_TESTS`.
 *
 * UNLIKE pg_cron, pgmq has no single-database constraint: its functions work in
 * ANY database, so every scenario here uses two snapshots in SPACE (isolated
 * `cluster.createDb(...)` databases) rather than mutating one shared database.
 * That is also what makes the LOAD-BEARING test of this file possible — the
 * full `export → load into a fresh shadow → re-extract` round trip, which
 * pg_cron structurally cannot have (a shadow database is never the cluster's
 * `cron.database_name`).
 */
import { describe, expect, test } from "bun:test";
import { apply } from "../src/apply/apply.ts";
import { plan } from "../src/plan/plan.ts";
import {
  type IntegrationProfile,
  resolveProfile,
} from "../src/integrations/profile.ts";
import { pgmqHandler } from "../src/policy/extensions/index.ts";
import { buildSchemaExport } from "../src/frontends/schema-export.ts";
import { loadSqlFiles, type SqlFile } from "../src/frontends/load-sql-files.ts";
import { runSupabaseBareTests, supabaseCluster } from "./containers.ts";

const pgmqProfile: IntegrationProfile = {
  id: "test-pgmq",
  handlers: [pgmqHandler],
};

/** Roles are cluster-global and already present; drop the CREATE ROLE file the
 *  same way `export-fidelity.test.ts` does, across every layout's naming. */
function forLoad(files: SqlFile[]): SqlFile[] {
  return files.filter((f) => !/cluster[_/]roles/.test(f.name));
}

describe.skipIf(!runSupabaseBareTests)(
  "extension-intent: pgmq queues (CLI-2054)",
  () => {
    test("create: queues in the desired state plan select pgmq.create(...) after CREATE EXTENSION, and applying them converges", async () => {
      const cluster = await supabaseCluster();
      const src = await cluster.createDb("pgmq_create_src");
      const desired = await cluster.createDb("pgmq_create_desired");
      try {
        // DESIRED: pgmq installed with a logged and an unlogged queue.
        await desired.pool.query(`CREATE EXTENSION pgmq`);
        await desired.pool.query(`SELECT pgmq.create('jobs')`);
        await desired.pool.query(`SELECT pgmq.create_unlogged('fast')`);

        const ctx = await resolveProfile(src.pool, pgmqProfile);
        const sourceFb = (await ctx.extract(src.pool)).factBase; // empty DB
        const desiredFb = (await ctx.extract(desired.pool)).factBase;

        const thePlan = plan(sourceFb, desiredFb, {
          ...ctx.planOptions,
          renames: "off",
        });

        const sqls = thePlan.actions.map((a) => a.sql);
        const extIdx = sqls.findIndex((s) =>
          /CREATE EXTENSION "pgmq"/i.test(s),
        );
        const jobsIdx = sqls.findIndex((s) =>
          /select pgmq\.create\('jobs'\)/.test(s),
        );
        const fastIdx = sqls.findIndex((s) =>
          /select pgmq\.create_unlogged\('fast'\)/.test(s),
        );
        expect(extIdx).toBeGreaterThanOrEqual(0);
        expect(jobsIdx).toBeGreaterThan(extIdx);
        expect(fastIdx).toBeGreaterThan(extIdx);
        expect(thePlan.actions[jobsIdx]?.verb).toBe("create");

        // the operational tables are pgmq's, never schema DDL
        expect(sqls.join("\n")).not.toMatch(/CREATE TABLE "pgmq"\."[qa]_/i);

        const report = await apply(thePlan, src.pool, ctx.applyOptions);
        expect(report.status).toBe("applied");

        // state proof: re-extracting the applied source converges on desired
        const appliedFb = (await ctx.extract(src.pool)).factBase;
        const residual = plan(appliedFb, desiredFb, {
          ...ctx.planOptions,
          renames: "off",
        });
        expect(residual.actions.map((a) => a.sql)).toEqual([]);

        const { rows } = await src.pool.query<{
          queue_name: string;
          is_unlogged: boolean;
        }>(`SELECT queue_name, is_unlogged FROM pgmq.meta ORDER BY queue_name`);
        expect(rows).toEqual([
          { queue_name: "fast", is_unlogged: true },
          { queue_name: "jobs", is_unlogged: false },
        ]);
      } finally {
        await Promise.all([src.drop(), desired.drop()]);
      }
    }, 180_000);

    test("drop: a queue absent from the desired state plans select pgmq.drop_queue(...) as DESTRUCTIVE", async () => {
      const cluster = await supabaseCluster();
      const src = await cluster.createDb("pgmq_drop_src");
      const desired = await cluster.createDb("pgmq_drop_desired");
      try {
        await src.pool.query(`CREATE EXTENSION pgmq`);
        await src.pool.query(`SELECT pgmq.create('jobs')`);
        await desired.pool.query(`CREATE EXTENSION pgmq`); // no queues

        const ctx = await resolveProfile(src.pool, pgmqProfile);
        const sourceFb = (await ctx.extract(src.pool)).factBase;
        const desiredFb = (await ctx.extract(desired.pool)).factBase;

        const thePlan = plan(sourceFb, desiredFb, {
          ...ctx.planOptions,
          renames: "off",
        });

        const dropAction = thePlan.actions.find((a) =>
          /select pgmq\.drop_queue\('jobs'\)/.test(a.sql),
        );
        expect(dropAction).toBeDefined();
        expect(dropAction?.verb).toBe("drop");
        // dropping a queue destroys every message still in it
        expect(dropAction?.dataLoss).toBe("destructive");

        // `allow-data-loss` is a CLI-level gate, not an `apply()` option — the
        // library applies a destructive action as planned.
        const report = await apply(thePlan, src.pool, ctx.applyOptions);
        expect(report.status).toBe("applied");

        const { rows } = await src.pool.query(`SELECT * FROM pgmq.meta`);
        expect(rows).toEqual([]);
      } finally {
        await Promise.all([src.drop(), desired.drop()]);
      }
    }, 180_000);

    test("a queue holding messages: the operational q_/a_ tables are projected out of the diff — never DROP TABLE'd", async () => {
      const cluster = await supabaseCluster();
      const src = await cluster.createDb("pgmq_msgs_src");
      const desired = await cluster.createDb("pgmq_msgs_desired");
      try {
        await src.pool.query(`CREATE EXTENSION pgmq`);
        await src.pool.query(`SELECT pgmq.create('jobs')`);
        await src.pool.query(
          `SELECT pgmq.send('jobs', '{"hello":"world"}'::jsonb)`,
        );
        await desired.pool.query(`CREATE EXTENSION pgmq`); // queue absent

        const ctx = await resolveProfile(src.pool, pgmqProfile);
        const sourceFb = (await ctx.extract(src.pool)).factBase;
        const desiredFb = (await ctx.extract(desired.pool)).factBase;

        // FORWARD (queue goes away): only the pgmq API call, no table DDL.
        const forward = plan(sourceFb, desiredFb, {
          ...ctx.planOptions,
          renames: "off",
        });
        const forwardSql = forward.actions.map((a) => a.sql).join("\n");
        expect(forwardSql).toMatch(/select pgmq\.drop_queue\('jobs'\)/);
        expect(forwardSql).not.toMatch(/DROP TABLE/i);

        // REVERSE (queue comes back): likewise no CREATE TABLE for q_/a_.
        const reverse = plan(desiredFb, sourceFb, {
          ...ctx.planOptions,
          renames: "off",
        });
        const reverseSql = reverse.actions.map((a) => a.sql).join("\n");
        expect(reverseSql).toMatch(/select pgmq\.create\('jobs'\)/);
        expect(reverseSql).not.toMatch(/CREATE TABLE/i);
      } finally {
        await Promise.all([src.drop(), desired.drop()]);
      }
    }, 180_000);

    // ── partitioned queues: unmanaged, but only BLOCKING on a key collision ──
    test("a partitioned queue with no same-name source queue is left unmanaged — the plan neither throws nor replays it", async () => {
      const cluster = await supabaseCluster();
      const src = await cluster.createDb("pgmq_parted_src");
      const desired = await cluster.createDb("pgmq_parted_desired");
      try {
        await src.pool.query(`CREATE EXTENSION pgmq`);
        // DESIRED: a PARTITIONED queue only pgmq/pg_partman can describe. Its
        // intervals live in part_config, so capture skips the fact and warns
        // (intent-unsupported). Nothing on the source side holds `parted`, so
        // this is benign drift — the plan must proceed.
        await desired.pool.query(`CREATE EXTENSION pgmq`);
        await desired.pool.query(`CREATE EXTENSION pg_partman`);
        await desired.pool.query(
          `SELECT pgmq.create_partitioned('parted', '10000', '100000')`,
        );

        const ctx = await resolveProfile(src.pool, pgmqProfile);
        const sourceFb = (await ctx.extract(src.pool)).factBase;
        const desiredFb = (await ctx.extract(desired.pool)).factBase;

        // the warning rides the fact base rather than blocking the plan
        expect(
          desiredFb.diagnostics.some(
            (d) => d.code === "intent-unsupported" && /parted/.test(d.message),
          ),
        ).toBe(true);

        const thePlan = plan(sourceFb, desiredFb, {
          ...ctx.planOptions,
          renames: "off",
        });
        // ...and no replay is invented for it
        expect(thePlan.actions.map((a) => a.sql).join("\n")).not.toMatch(
          /pgmq\.create\w*\('parted'\)/,
        );
      } finally {
        await Promise.all([src.drop(), desired.drop()]);
      }
    }, 180_000);

    test("a same-key collision — regular queue in the source, PARTITIONED in the desired — is refused at plan time", async () => {
      const cluster = await supabaseCluster();
      const src = await cluster.createDb("pgmq_clash_src");
      const desired = await cluster.createDb("pgmq_clash_desired");
      try {
        // SOURCE: a regular (manageable) queue `clash`.
        await src.pool.query(`CREATE EXTENSION pgmq`);
        await src.pool.query(`SELECT pgmq.create('clash')`);
        // DESIRED: the SAME name as a partitioned queue — captured as a
        // diagnostic, not a fact. Ungated the diff reads that as a removal and
        // plans a bare destructive `pgmq.drop_queue('clash')` whose proof
        // falsely converges, because the desired re-extract skips it too.
        await desired.pool.query(`CREATE EXTENSION pgmq`);
        await desired.pool.query(`CREATE EXTENSION pg_partman`);
        await desired.pool.query(
          `SELECT pgmq.create_partitioned('clash', '10000', '100000')`,
        );

        const ctx = await resolveProfile(src.pool, pgmqProfile);
        const sourceFb = (await ctx.extract(src.pool)).factBase;
        const desiredFb = (await ctx.extract(desired.pool)).factBase;

        expect(() =>
          plan(sourceFb, desiredFb, { ...ctx.planOptions, renames: "off" }),
        ).toThrow(/cannot replay[\s\S]*pgmq\/queue 'clash'/);
      } finally {
        await Promise.all([src.drop(), desired.drop()]);
      }
    }, 180_000);

    // ── the load-bearing deliverable (CLI-2054) ─────────────────────────────
    test("ROUND TRIP: export → load into a fresh shadow → re-extract converges", async () => {
      const cluster = await supabaseCluster();
      const src = await cluster.createDb("pgmq_rt_src");
      const shadow = await cluster.createDb("pgmq_rt_shadow");
      try {
        await src.pool.query(`CREATE EXTENSION pgmq`);
        await src.pool.query(`SELECT pgmq.create('jobs')`);
        await src.pool.query(`SELECT pgmq.create_unlogged('fast')`);
        // a real message: the queue's DATA must not leak into the export, and
        // the loader's populated-table guard must not trip on pgmq's own rows.
        await src.pool.query(
          `SELECT pgmq.send('jobs', '{"hello":"world"}'::jsonb)`,
        );

        const ctx = await resolveProfile(src.pool, pgmqProfile);

        const exported = await buildSchemaExport(src.pool, {
          profile: pgmqProfile,
        });
        const files = forLoad(exported.files);

        // the queue intent is exported as pgmq's OWN API call, verbatim
        const replays = files
          .flatMap((f) => f.sql.split("\n"))
          .map((l) => l.trim())
          .filter((l) => /^select pgmq\./i.test(l));
        expect(replays).toMatchInlineSnapshot(`
          [
            "select pgmq.create_unlogged('fast');",
            "select pgmq.create('jobs');",
          ]
        `);

        // ...and no message data was exported
        expect(files.map((f) => f.sql).join("\n")).not.toMatch(/hello/);

        // load the exported files into a FRESH shadow, profile-aware so the
        // shadow's desired state is captured with the same handler.
        const loaded = await loadSqlFiles(files, shadow.pool, {
          extract: ctx.extract,
        });

        // convergence: the reloaded shadow diffs to nothing against the source
        const srcFb = (await ctx.extract(src.pool)).factBase;
        const residual = plan(loaded.factBase, srcFb, {
          ...ctx.planOptions,
          renames: "off",
        });
        expect(residual.actions.map((a) => a.sql)).toEqual([]);

        // and the queues really exist in the shadow, with their persistence
        const { rows } = await shadow.pool.query<{
          queue_name: string;
          is_unlogged: boolean;
        }>(`SELECT queue_name, is_unlogged FROM pgmq.meta ORDER BY queue_name`);
        expect(rows).toEqual([
          { queue_name: "fast", is_unlogged: true },
          { queue_name: "jobs", is_unlogged: false },
        ]);
      } finally {
        await Promise.all([src.drop(), shadow.drop()]);
      }
    }, 180_000);
  },
);
