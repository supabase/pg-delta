/**
 * Extension-intent for pg_partman, end-to-end against a real pg_partman DB
 * (docs/architecture/extension-intent.md §3.3, §4.3).
 *
 * Deliverable A (CLI-1555 / CLI-1591) reproduces the destructive bug — a
 * declarative diff DROPs the partman child partitions — and proves the
 * pg_partman handler + the managed view stop it, while leaving the partitioned
 * parent intact. Handlers now run INSIDE the extraction transaction
 * (`extract(pool, { handlers })`) and `resolveView` (inside `plan`/`prove`) is
 * the single projection point that drops the `managedBy` children — no
 * caller-side `excludeManaged`.
 *
 * Deliverable B (CLI-2044) covers the `part_config` INTENT: a from-scratch
 * rebuild must produce a REGISTERED parent (`partman.create_parent(...)` replayed
 * after `CREATE TABLE` and `CREATE EXTENSION`), not a bare `PARTITION BY RANGE`
 * shell. Those scenarios drive the public profile seam (`resolveProfile`) with a
 * custom profile carrying only `pgPartmanHandler`, exactly like
 * `extension-intent-pgmq.test.ts`, and close with the same load-bearing
 * `export → load into a fresh shadow → re-extract` round trip.
 *
 * Uses the Supabase image, which ships pg_partman.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { apply } from "../src/apply/apply.ts";
import { extract } from "../src/extract/extract.ts";
import type { ExtensionHandler } from "../src/extract/handler.ts";
import { diff, type Delta } from "../src/core/diff.ts";
import { resolveView } from "../src/policy/policy.ts";
import { pgPartmanHandler } from "../src/policy/extensions/index.ts";
import { plan } from "../src/plan/plan.ts";
import { buildIntentRuleIndex } from "../src/plan/rules.ts";
import { provePlan } from "../src/proof/prove.ts";
import {
  type IntegrationProfile,
  resolveProfile,
} from "../src/integrations/profile.ts";
import { buildSchemaExport } from "../src/frontends/schema-export.ts";
import { loadSqlFiles, type SqlFile } from "../src/frontends/load-sql-files.ts";
import type { StableId } from "../src/core/stable-id.ts";
import {
  runSupabaseBareTests,
  sharedCluster,
  supabaseCluster,
  type TestDb,
} from "./containers.ts";

const eventsParent: StableId = {
  kind: "table",
  schema: "public",
  name: "events",
};

/** a `remove` of a partman child partition (public.events_* but not the parent) */
function dropsPartmanChild(deltas: Delta[]): boolean {
  return deltas.some(
    (d) =>
      d.verb === "remove" &&
      d.fact.id.kind === "table" &&
      d.fact.id.schema === "public" &&
      d.fact.id.name !== "events" &&
      d.fact.id.name.startsWith("events"),
  );
}

const dbs: TestDb[] = [];
afterAll(async () => {
  await Promise.all(dbs.map((d) => d.drop().catch(() => {})));
});

describe("extension-intent: pg_partman managed partitions are not dropped (CLI-1555)", () => {
  test("handler-aware extraction + resolveView stop the destructive drop, parent survives", async () => {
    const cluster = await supabaseCluster();

    // SOURCE: the live DB — partman creates child partitions at runtime
    const source = await cluster.createDb("partman_src");
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
           p_interval := '1 day'
         )`,
    );

    // DESIRED: the declarative source — only the parent is declared
    const desired = await cluster.createDb("partman_dst");
    dbs.push(desired);
    await desired.pool.query(
      `CREATE TABLE public.events (
           id bigint GENERATED ALWAYS AS IDENTITY,
           created_at timestamptz NOT NULL
         ) PARTITION BY RANGE (created_at)`,
    );

    // CONTROL: a plain diff (no handler) DROPs the partman children
    const sourceRaw = await extract(source.pool);
    const desiredRaw = await extract(desired.pool);
    expect(
      dropsPartmanChild(diff(sourceRaw.factBase, desiredRaw.factBase)),
    ).toBe(true);

    // FIXED: handler-aware extraction tags children `managedBy` on the core
    // snapshot; resolveView (no policy) projects them out of BOTH sides → no
    // drop, parent preserved. This is the DEFAULT projection the planner uses.
    const sourceManaged = resolveView(
      (await extract(source.pool, { handlers: [pgPartmanHandler] })).factBase,
      undefined,
    );
    const desiredManaged = resolveView(
      (await extract(desired.pool, { handlers: [pgPartmanHandler] })).factBase,
      undefined,
    );
    const fixedDeltas = diff(sourceManaged, desiredManaged);

    expect(dropsPartmanChild(fixedDeltas)).toBe(false);
    expect(sourceManaged.has(eventsParent)).toBe(true);
  }, 180_000);

  test("the managed plan is proof-clean and preserves child rows (data-preservation)", async () => {
    const cluster = await supabaseCluster();
    const handlers = [pgPartmanHandler];

    // SOURCE: parent + partman children + a seeded row in a child
    const source = await cluster.createDb("partman_prove_src");
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
         p_interval := '1 day'
       )`,
    );
    await source.pool.query(
      `INSERT INTO public.events (created_at) VALUES (now())`,
    );

    // DESIRED: the declarative source declares the extension, the partitioned
    // parent, and — since Deliverable B — the SAME partman registration, while
    // making a REAL parent change (adds a column). Its own premade children are
    // runtime state the managed view projects out, so the plan carries only the
    // ALTER ADD COLUMN and must not touch the source's managed partitions.
    //
    // The registration is declared on BOTH sides on purpose: with the
    // `part_config` row now captured as intent, a desired state that omitted
    // `create_parent` would be asking to DEREGISTER the parent, which is a
    // different scenario (covered below in the Deliverable B drop test).
    const desiredDb = await cluster.createDb("partman_prove_dst");
    dbs.push(desiredDb);
    await desiredDb.pool.query(`CREATE SCHEMA IF NOT EXISTS partman`);
    await desiredDb.pool.query(
      `CREATE EXTENSION IF NOT EXISTS pg_partman WITH SCHEMA partman`,
    );
    await desiredDb.pool.query(
      `CREATE TABLE public.events (
         id bigint GENERATED ALWAYS AS IDENTITY,
         created_at timestamptz NOT NULL,
         note text
       ) PARTITION BY RANGE (created_at)`,
    );
    await desiredDb.pool.query(
      `SELECT partman.create_parent(
         p_parent_table := 'public.events',
         p_control := 'created_at',
         p_interval := '1 day'
       )`,
    );

    // handler-aware extraction on both sides; plan's resolveView drops the
    // managed children, so the plan only carries the parent's column add.
    const sourceFb = (await extract(source.pool, { handlers })).factBase;
    const desiredFb = (await extract(desiredDb.pool, { handlers })).factBase;
    // Since Deliverable B the handler also captures the `part_config` row as an
    // intent fact, so a bare `plan()` must be handed the handler's replay rules
    // (this is what `resolveProfile` does for every real caller). Without them
    // the resolver throws "no intent rule registered" rather than silently
    // dropping declared intent.
    const thePlan = plan(sourceFb, desiredFb, {
      renames: "off",
      compact: true,
      intentRules: buildIntentRuleIndex(handlers),
    });

    // prove against a sacrificial clone of the source, re-extracting with the
    // SAME handler-aware extractor so the proof projects the SAME managed view.
    const clone = await source.clone();
    dbs.push(clone);
    const verdict = await provePlan(thePlan, clone.pool, desiredFb, {
      reextract: (pool) => extract(pool, { handlers }),
    });

    expect(verdict.applyError).toBeUndefined();
    expect(verdict.driftDeltas).toEqual([]);
    expect(verdict.dataViolations).toEqual([]);
    expect(verdict.ok).toBe(true);
    // the proof reports honest coverage; the seeded child partition is checked.
    expect(verdict.coverage.tablesChecked).toBeGreaterThan(0);

    // the seeded child row survived the migration on the clone
    const { rows } = await clone.pool.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM public.events`,
    );
    expect(rows[0]?.c).toBe(1);
  }, 180_000);

  test("extension handlers capture on the SAME snapshot as core extraction (coherence)", async () => {
    // Proves handlers run inside the core REPEATABLE READ transaction, not on
    // a fresh post-COMMIT connection. A committed write issued on a DIFFERENT
    // backend DURING capture must be invisible to the handler's snapshot-bound
    // query — otherwise handler edges could describe a different moment in DB
    // time than the core facts they reference (P1).
    const cluster = await sharedCluster();
    const db = await cluster.createDb("handler_snapshot");
    dbs.push(db);
    await db.pool.query(`CREATE TABLE public.t (id int)`);
    await db.pool.query(`INSERT INTO public.t VALUES (1)`);

    let seen = -1;
    const probe: ExtensionHandler = {
      extension: "probe",
      async capture(ctx) {
        const writer = await db.pool.connect();
        try {
          await writer.query(`INSERT INTO public.t VALUES (2)`);
        } finally {
          writer.release();
        }
        const rows = await ctx.query(`SELECT count(*)::int AS c FROM public.t`);
        seen = Number(rows[0]?.["c"]);
        return { facts: [], edges: [] };
      },
    };

    await extract(db.pool, { handlers: [probe] });
    // frozen snapshot opened before capture → the concurrent insert is unseen.
    expect(seen).toBe(1);
  }, 120_000);
});

// ── Deliverable B: part_config intent capture + replay (CLI-2044) ────────────

const partmanProfile: IntegrationProfile = {
  id: "test-pg-partman",
  handlers: [pgPartmanHandler],
};

/** Roles are cluster-global and already present; drop the CREATE ROLE file the
 *  same way `export-fidelity.test.ts` does, across every layout's naming. */
function forLoad(files: SqlFile[]): SqlFile[] {
  return files.filter((f) => !/cluster[_/]roles/.test(f.name));
}

/** Install partman and register `public.events` with the given extra
 *  `create_parent` arguments (named, so order is irrelevant). */
async function seedPartmanParent(
  db: TestDb,
  extraArgs = "",
  columns = "id bigint GENERATED ALWAYS AS IDENTITY, created_at timestamptz NOT NULL",
): Promise<void> {
  await db.pool.query(`CREATE SCHEMA IF NOT EXISTS partman`);
  await db.pool.query(
    `CREATE EXTENSION IF NOT EXISTS pg_partman WITH SCHEMA partman`,
  );
  await db.pool.query(
    `CREATE TABLE public.events (${columns}) PARTITION BY RANGE (created_at)`,
  );
  await db.pool.query(
    `SELECT partman.create_parent(
       p_parent_table := 'public.events',
       p_control := 'created_at',
       p_interval := '1 day'${extraArgs}
     )`,
  );
}

/** The intent columns the replay must reproduce exactly (the runtime columns —
 *  datetime_string, undo_in_progress, maintenance_last_run — are deliberately
 *  excluded; see the disposition table in `src/policy/extensions/pg-partman.ts`). */
const INTENT_COLUMNS = `parent_table, control, partition_interval, partition_type,
    epoch, premake, automatic_maintenance, constraint_cols, template_table,
    jobmon, date_trunc_interval, time_encoder, time_decoder, retention,
    retention_schema, retention_keep_index, retention_keep_table,
    retention_keep_publication, optimize_constraint, infinite_time_partitions,
    inherit_privileges, constraint_valid, ignore_default_data, maintenance_order`;

describe.skipIf(!runSupabaseBareTests)(
  "extension-intent: pg_partman create_parent intent (CLI-2044)",
  () => {
    test("create: a from-scratch rebuild replays create_parent AFTER the extension and the parent table, and converges", async () => {
      const cluster = await supabaseCluster();
      const src = await cluster.createDb("partman_b_create_src");
      const desired = await cluster.createDb("partman_b_create_desired");
      try {
        await seedPartmanParent(desired);

        const ctx = await resolveProfile(src.pool, partmanProfile);
        const sourceFb = (await ctx.extract(src.pool)).factBase; // empty DB
        const desiredFb = (await ctx.extract(desired.pool)).factBase;

        const thePlan = plan(sourceFb, desiredFb, {
          ...ctx.planOptions,
          renames: "off",
        });

        const sqls = thePlan.actions.map((a) => a.sql);
        const extIdx = sqls.findIndex((s) =>
          /CREATE EXTENSION "pg_partman"/i.test(s),
        );
        const tableIdx = sqls.findIndex((s) =>
          /CREATE TABLE "public"\."events"/i.test(s),
        );
        const intentIdx = sqls.findIndex((s) =>
          /create_parent\(p_parent_table := 'public\.events'/.test(s),
        );
        expect(extIdx).toBeGreaterThanOrEqual(0);
        expect(tableIdx).toBeGreaterThanOrEqual(0);
        // ordered after BOTH: the `depends` edge on the extension fact and the
        // `consumes` on the parent table.
        expect(intentIdx).toBeGreaterThan(extIdx);
        expect(intentIdx).toBeGreaterThan(tableIdx);
        expect(thePlan.actions[intentIdx]?.verb).toBe("create");

        // the premade children and the auto-created template table are
        // partman's — never schema DDL
        const all = sqls.join("\n");
        expect(all).not.toMatch(/CREATE TABLE "public"\."events_/i);
        expect(all).not.toMatch(/template_public_events/i);

        const report = await apply(thePlan, src.pool, ctx.applyOptions);
        expect(report.status).toBe("applied");

        // state proof: re-extracting the applied source converges on desired
        const appliedFb = (await ctx.extract(src.pool)).factBase;
        const residual = plan(appliedFb, desiredFb, {
          ...ctx.planOptions,
          renames: "off",
        });
        expect(residual.actions.map((a) => a.sql)).toEqual([]);

        // ...and the parent really is REGISTERED, on every intent column
        const both = await Promise.all(
          [src, desired].map(
            async (db) =>
              (
                await db.pool.query(
                  `SELECT ${INTENT_COLUMNS} FROM partman.part_config ORDER BY parent_table`,
                )
              ).rows,
          ),
        );
        expect(both[0]).toHaveLength(1);
        expect(both[0]).toEqual(both[1] as never);

        // premade children exist on the rebuilt source (partman ran, not DDL)
        const { rows: children } = await src.pool.query<{ c: number }>(
          `SELECT count(*)::int AS c FROM pg_inherits WHERE inhparent = 'public.events'::regclass`,
        );
        expect(children[0]?.c).toBeGreaterThan(0);
      } finally {
        await Promise.all([src.drop(), desired.drop()]);
      }
    }, 180_000);

    test("create: non-argument part_config settings (retention, …) replay as a follow-up UPDATE and converge", async () => {
      const cluster = await supabaseCluster();
      const src = await cluster.createDb("partman_b_settings_src");
      const desired = await cluster.createDb("partman_b_settings_desired");
      try {
        await seedPartmanParent(desired);
        // These have NO create_parent argument — partman's documented way to set
        // them is to UPDATE part_config after registration.
        await desired.pool.query(
          `UPDATE partman.part_config
              SET retention = '3 months',
                  retention_keep_table = false,
                  infinite_time_partitions = true,
                  optimize_constraint = 10
            WHERE parent_table = 'public.events'`,
        );

        const ctx = await resolveProfile(src.pool, partmanProfile);
        const sourceFb = (await ctx.extract(src.pool)).factBase;
        const desiredFb = (await ctx.extract(desired.pool)).factBase;

        const thePlan = plan(sourceFb, desiredFb, {
          ...ctx.planOptions,
          renames: "off",
        });

        const sqls = thePlan.actions.map((a) => a.sql);
        const createIdx = sqls.findIndex((s) => /create_parent\(/.test(s));
        const updateIdx = sqls.findIndex((s) =>
          /update "partman"\.part_config set/.test(s),
        );
        expect(createIdx).toBeGreaterThanOrEqual(0);
        // the UPDATE is the SECOND statement of the same create, so it must
        // follow the registration it patches
        expect(updateIdx).toBeGreaterThan(createIdx);

        const report = await apply(thePlan, src.pool, ctx.applyOptions);
        expect(report.status).toBe("applied");

        const appliedFb = (await ctx.extract(src.pool)).factBase;
        const residual = plan(appliedFb, desiredFb, {
          ...ctx.planOptions,
          renames: "off",
        });
        expect(residual.actions.map((a) => a.sql)).toEqual([]);

        const { rows } = await src.pool.query(
          `SELECT retention, retention_keep_table, infinite_time_partitions, optimize_constraint
             FROM partman.part_config WHERE parent_table = 'public.events'`,
        );
        expect(rows).toEqual([
          {
            retention: "3 months",
            retention_keep_table: false,
            infinite_time_partitions: true,
            optimize_constraint: 10,
          },
        ]);
      } finally {
        await Promise.all([src.drop(), desired.drop()]);
      }
    }, 180_000);

    test("drop: an unregistered desired state DEREGISTERS the parent without destroying a single partition", async () => {
      const cluster = await supabaseCluster();
      const src = await cluster.createDb("partman_b_drop_src");
      const desired = await cluster.createDb("partman_b_drop_desired");
      try {
        await seedPartmanParent(src);
        await src.pool.query(
          `INSERT INTO public.events (created_at) VALUES (now())`,
        );
        // DESIRED: the same extension + parent, but NO registration.
        await desired.pool.query(`CREATE SCHEMA IF NOT EXISTS partman`);
        await desired.pool.query(
          `CREATE EXTENSION IF NOT EXISTS pg_partman WITH SCHEMA partman`,
        );
        await desired.pool.query(
          `CREATE TABLE public.events (
             id bigint GENERATED ALWAYS AS IDENTITY,
             created_at timestamptz NOT NULL
           ) PARTITION BY RANGE (created_at)`,
        );

        const ctx = await resolveProfile(src.pool, partmanProfile);
        const sourceFb = (await ctx.extract(src.pool)).factBase;
        const desiredFb = (await ctx.extract(desired.pool)).factBase;

        const thePlan = plan(sourceFb, desiredFb, {
          ...ctx.planOptions,
          renames: "off",
        });

        const dropAction = thePlan.actions.find((a) =>
          /delete from "partman"\.part_config/.test(a.sql),
        );
        expect(dropAction).toBeDefined();
        expect(dropAction?.verb).toBe("drop");
        // deregistering destroys NOTHING — see the drop rationale in the handler
        expect(dropAction?.dataLoss ?? "none").toBe("none");
        // and it is the ONLY thing planned: no partition is dropped
        expect(thePlan.actions.map((a) => a.sql)).toEqual([dropAction!.sql]);

        const report = await apply(thePlan, src.pool, ctx.applyOptions);
        expect(report.status).toBe("applied");

        const { rows: cfg } = await src.pool.query(
          `SELECT * FROM partman.part_config`,
        );
        expect(cfg).toEqual([]);

        // DOCUMENTED CONSEQUENCE (CLI-2044 triage): the partitions survive —
        // with their rows — but lose their `managedBy` tag, so they surface as
        // ORDINARY user tables that a SECOND sync round removes under the normal
        // data-loss gate. That is deliberate: a one-shot replay that silently
        // mass-DROPped them would destroy data the user never saw planned.
        const { rows: kept } = await src.pool.query<{ c: number }>(
          `SELECT count(*)::int AS c FROM public.events`,
        );
        expect(kept[0]?.c).toBe(1);

        const secondRound = plan(
          (await ctx.extract(src.pool)).factBase,
          desiredFb,
          { ...ctx.planOptions, renames: "off" },
        );
        expect(secondRound.actions.some((a) => /DROP TABLE/i.test(a.sql))).toBe(
          true,
        );
      } finally {
        await Promise.all([src.drop(), desired.drop()]);
      }
    }, 180_000);

    test("a SUB-partitioned set emits INTENT_UNSUPPORTED, no intent fact, and keeps every level tagged managedBy", async () => {
      const cluster = await supabaseCluster();
      const db = await cluster.createDb("partman_b_subpart");
      try {
        await seedPartmanParent(db);
        // partman refuses to sub-partition an already-populated declarative set
        // without an explicit acknowledgement that existing children are
        // recreated; the set is empty here, so this is safe.
        await db.pool.query(
          `SELECT partman.create_sub_parent(
             p_top_parent := 'public.events',
             p_control := 'created_at',
             p_interval := '1 hour',
             p_declarative_check := 'yes'
           )`,
        );

        const extracted = await extract(db.pool, {
          handlers: [pgPartmanHandler],
        });

        // no parent of a sub-partitioned set becomes intent…
        const intents = extracted.factBase
          .facts()
          .filter((f) => f.id.kind === "extensionIntent");
        expect(intents).toEqual([]);
        // …and every skipped row says so
        const unsupported = extracted.diagnostics.filter(
          (d) => d.code === "intent-unsupported",
        );
        expect(unsupported.length).toBeGreaterThan(0);
        expect(unsupported[0]?.message).toMatch(/SUB-PARTITIONED/);

        // Phase A is untouched: the recursive pg_inherits walk still tags every
        // level, so a diff against an empty desired state drops no partition.
        const managed = resolveView(extracted.factBase, undefined);
        const remaining = managed
          .facts()
          .filter(
            (f) =>
              f.id.kind === "table" &&
              f.id.schema === "public" &&
              f.id.name.startsWith("events_"),
          );
        expect(remaining).toEqual([]);
      } finally {
        await db.drop();
      }
    }, 180_000);

    test("a pgmq-OWNED partitioned queue is not captured as create_parent intent, while its partitions stay managedBy", async () => {
      const cluster = await supabaseCluster();
      const db = await cluster.createDb("partman_b_pgmq_queue");
      try {
        // an ORDINARY user parent (public.events) plus a pgmq partitioned
        // queue. `pgmq.create_partitioned` registers BOTH `pgmq.q_pq` and
        // `pgmq.a_pq` in partman's part_config, but the queue tables are
        // pgmq's — the pgmq handler deliberately emits NO fact for a
        // partitioned queue, and under the Supabase profile the whole `pgmq`
        // schema is projected out. Replaying them as `create_parent` would
        // consume a table nothing creates.
        await seedPartmanParent(db);
        await db.pool.query(`CREATE EXTENSION pgmq`);
        await db.pool.query(`SELECT pgmq.create_partitioned('pq')`);

        const extracted = await extract(db.pool, {
          handlers: [pgPartmanHandler],
        });

        // the user's parent IS intent; neither queue table is
        const intentKeys = extracted.factBase
          .facts()
          .filter((f) => f.id.kind === "extensionIntent")
          .map((f) => (f.id as { key: string }).key);
        expect(intentKeys).toEqual(["public.events"]);

        // …and every skipped row says why
        const unsupported = extracted.diagnostics.filter(
          (d) => d.code === "intent-unsupported",
        );
        expect(unsupported.length).toBeGreaterThan(0);
        expect(unsupported.map((d) => d.message).join("\n")).toMatch(/pgmq/);

        // Phase A is untouched: the queue's OWN partitions (created by partman,
        // not extension members) are still tagged managedBy, so nothing plans a
        // DROP TABLE against them.
        const queueParts = extracted.factBase
          .facts()
          .filter(
            (f) =>
              f.id.kind === "table" &&
              f.id.schema === "pgmq" &&
              /^[qa]_pq_/.test(f.id.name),
          );
        expect(queueParts.length).toBeGreaterThan(0);
        for (const part of queueParts) {
          expect(
            extracted.factBase
              .outgoingEdges(part.id)
              .some((e) => e.kind === "managedBy"),
          ).toBe(true);
        }
        // which is exactly what the managed view relies on. (The queue's OWN
        // `q_pq` / `a_pq` tables survive here because only the partman handler
        // is composed — tagging those is the pgmq handler's job, and the
        // Supabase profile projects the whole schema out anyway.)
        const managed = resolveView(extracted.factBase, undefined);
        expect(
          managed
            .facts()
            .filter(
              (f) =>
                f.id.kind === "table" &&
                f.id.schema === "pgmq" &&
                /^[qa]_pq_/.test(f.id.name),
            ),
        ).toEqual([]);
      } finally {
        await db.drop();
      }
    }, 180_000);

    // ── the load-bearing deliverable (CLI-2044) ─────────────────────────────
    test("ROUND TRIP: export → load into a fresh shadow → re-extract yields a CONFIGURED parent and an empty diff", async () => {
      const cluster = await supabaseCluster();
      const src = await cluster.createDb("partman_b_rt_src");
      const shadow = await cluster.createDb("partman_b_rt_shadow");
      try {
        await seedPartmanParent(src, `, p_premake := 2`);
        await src.pool.query(
          `UPDATE partman.part_config
              SET retention = '6 months', infinite_time_partitions = true
            WHERE parent_table = 'public.events'`,
        );
        // real data: it must not leak into the export, and the loader's
        // populated-table guard must not trip on partman's own registry rows.
        await src.pool.query(
          `INSERT INTO public.events (created_at) VALUES (now())`,
        );

        const ctx = await resolveProfile(src.pool, partmanProfile);

        const exported = await buildSchemaExport(src.pool, {
          profile: partmanProfile,
        });
        const files = forLoad(exported.files);

        // the registration is exported as partman's OWN API call, plus the
        // follow-up UPDATE for the settings create_parent cannot express
        const replays = files
          .flatMap((f) => f.sql.split("\n"))
          .map((l) => l.trim())
          .filter((l) => /^(select "partman"|update "partman")/i.test(l));
        expect(replays).toMatchInlineSnapshot(`
          [
            "select "partman".create_parent(p_parent_table := 'public.events', p_control := 'created_at', p_interval := '1 day', p_type := 'range', p_epoch := 'none', p_premake := 2, p_default_table := true, p_automatic_maintenance := 'on', p_constraint_cols := NULL, p_jobmon := true, p_date_trunc_interval := NULL, p_control_not_null := false, p_time_encoder := NULL, p_time_decoder := NULL);",
            "update "partman".part_config set "retention" = '6 months', "retention_schema" = NULL, "retention_keep_index" = true, "retention_keep_table" = true, "retention_keep_publication" = false, "optimize_constraint" = 30, "infinite_time_partitions" = true, "inherit_privileges" = false, "constraint_valid" = true, "ignore_default_data" = true, "maintenance_order" = NULL where "parent_table" = 'public.events';",
          ]
        `);

        // no premade child, no auto-created template table, and no row data
        const allSql = files.map((f) => f.sql).join("\n");
        expect(allSql).not.toMatch(/CREATE TABLE "public"\."events_/i);
        expect(allSql).not.toMatch(/template_public_events/i);
        expect(allSql).not.toMatch(/INSERT INTO "public"\."events"/i);

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

        // and the shadow really carries a CONFIGURED parent — identical on every
        // intent column — with its own premade children
        const both = await Promise.all(
          [shadow, src].map(
            async (db) =>
              (
                await db.pool.query(
                  `SELECT ${INTENT_COLUMNS} FROM partman.part_config ORDER BY parent_table`,
                )
              ).rows,
          ),
        );
        expect(both[0]).toHaveLength(1);
        expect(both[0]).toEqual(both[1] as never);

        const { rows: children } = await shadow.pool.query<{ c: number }>(
          `SELECT count(*)::int AS c FROM pg_inherits WHERE inhparent = 'public.events'::regclass`,
        );
        expect(children[0]?.c).toBeGreaterThan(0);
      } finally {
        await Promise.all([src.drop(), shadow.drop()]);
      }
    }, 180_000);
  },
);
