/**
 * Supabase-image integration suite (Tier 4 of the port-parity plan).
 *
 * These exercise behavior that only the Supabase bare image
 * (`supabaseCluster()`, PG17, ships pgvector / pgmq / pg_partman / pg_cron) can
 * reach — they are NOT corpus scenarios. The whole file self-gates via
 * `runSupabaseBareTests` so a PR spins the heavy image only on the matching
 * matrix leg, never on all five (see tests/containers.ts).
 *
 * Ported from:
 *  - pg-delta/tests/integration/extension-operations.test.ts (pgvector typmod)
 *  - pg-delta/tests/integration/pgmq-declarative-roundtrip.test.ts
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { apply } from "../src/apply/apply.ts";
import { cmdSchemaApply, cmdSchemaExport } from "../src/cli/commands/schema.ts";
import { resolveCliProfile } from "../src/cli/profile.ts";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import {
  runSupabaseBareTests,
  supabaseCluster,
  type TestDb,
} from "./containers.ts";

describe.skipIf(!runSupabaseBareTests)(
  "supabase bare-image integration",
  () => {
    test("preserves pgvector typmod dimensions through extraction and ADD COLUMN SQL", async () => {
      const cluster = await supabaseCluster();
      const main = await cluster.createDb("supa_vec_main");
      const branch = await cluster.createDb("supa_vec_branch");
      try {
        const setup = `
          CREATE SCHEMA test_schema;
          CREATE EXTENSION IF NOT EXISTS vector SCHEMA test_schema;
          CREATE TABLE test_schema.embeddings (
            id serial PRIMARY KEY,
            title text NOT NULL,
            embedding test_schema.halfvec(384) NOT NULL
          );
          CREATE INDEX embeddings_hnsw_idx
            ON test_schema.embeddings
            USING hnsw (embedding test_schema.halfvec_l2_ops)
            WITH (m = 16, ef_construction = 64);
        `;
        await main.pool.query(setup);
        await branch.pool.query(setup);
        await branch.pool.query(`
          ALTER TABLE test_schema.embeddings
            ADD COLUMN embedding_v2 test_schema.vector(768);
        `);

        const [s, d] = [await extract(main.pool), await extract(branch.pool)];

        // typmod survives extraction on the existing and the new column.
        const columnType = (fb: typeof d.factBase, col: string): string => {
          const fact = fb
            .facts()
            .find(
              (f) =>
                f.id.kind === "column" &&
                (f.id as { name: string }).name === col &&
                (f.id as { table?: string }).table === "embeddings",
            );
          if (!fact) throw new Error(`column ${col} not found`);
          return (fact.payload as { type: string }).type;
        };
        expect(columnType(d.factBase, "embedding")).toContain("halfvec(384)");
        expect(columnType(d.factBase, "embedding_v2")).toContain("vector(768)");

        // and the diff emits exactly the typmod-bearing ADD COLUMN.
        const thePlan = plan(s.factBase, d.factBase);
        const addCol = thePlan.actions.filter((a) =>
          a.sql.includes("ADD COLUMN"),
        );
        expect(addCol).toHaveLength(1);
        expect(addCol[0]!.sql).toContain("vector(768)");
        expect(addCol[0]!.sql).not.toContain("vector(0)");
      } finally {
        await Promise.all([main.drop(), branch.drop()]);
      }
    }, 180_000);

    test("pgmq extension + queue + SECURITY DEFINER functions roundtrip cleanly under the supabase profile", async () => {
      const cluster = await supabaseCluster();
      const main = await cluster.createDb("supa_pgmq_main");
      const branch = await cluster.createDb("supa_pgmq_branch");
      const dbs: TestDb[] = [main, branch];
      // Real Supabase projects are owned by the non-superuser `postgres` role
      // (so `pg_database_owner` → `postgres` owns `public`). Mirror that on
      // BOTH sides, and drive the user-owned objects (queue + wrapper
      // functions) through a faithful `postgres` connection — otherwise they
      // are `supabase_admin`-owned and the supabase profile's Rule 6
      // owner-exclusion silently drops them from the managed view, making the
      // convergence assertion below pass vacuously.
      await cluster.adminPool.query(
        `ALTER DATABASE "${main.name}" OWNER TO postgres`,
      );
      await cluster.adminPool.query(
        `ALTER DATABASE "${branch.name}" OWNER TO postgres`,
      );
      const mainPg = new pg.Pool({
        connectionString: main.postgresUri,
        max: 5,
      });
      const branchPg = new pg.Pool({
        connectionString: branch.postgresUri,
        max: 5,
      });
      mainPg.on("error", () => {});
      branchPg.on("error", () => {});
      try {
        // branch: pgmq extension, a queue, and the public SECURITY DEFINER
        // wrappers Supabase ships around pgmq.* (the user-managed objects that
        // must round-trip; pgmq's own schema objects are extension members the
        // profile projects out). All created as `postgres` — production
        // Supabase grants the privileged role CREATE EXTENSION + pgmq.create()
        // rights, so this is what a real project's setup script would run.
        await branchPg.query(`
          CREATE EXTENSION pgmq;
          SELECT FROM pgmq.create('my_queue');

          CREATE FUNCTION public.pgmq_read(
            queue_name text, sleep_seconds integer DEFAULT 0, n integer DEFAULT 1
          ) RETURNS SETOF pgmq.message_record
            LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pgmq'
            AS $fn$
            BEGIN
              RETURN QUERY SELECT * FROM pgmq.read(queue_name, sleep_seconds, n);
            END;
            $fn$;

          CREATE FUNCTION public.pgmq_delete(queue_name text, message_id bigint)
            RETURNS boolean
            LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pgmq'
            AS $fn$
            BEGIN
              RETURN pgmq.delete(queue_name, message_id);
            END;
            $fn$;
        `);

        const ctx = await resolveCliProfile(mainPg, "supabase");
        const extractFn = ctx.extract ?? extract;
        const [s, d] = await Promise.all([
          extractFn(mainPg),
          extractFn(branchPg),
        ]);

        const thePlan = plan(s.factBase, d.factBase, {
          compact: true,
          ...ctx.planOptions,
        });
        expect(thePlan.actions.length).toBeGreaterThan(0);
        // anti-vacuity: the public wrapper must actually be IN the managed
        // plan, or the convergence assertion below proves nothing (Rule 6
        // would exclude it as owned by a system role).
        expect(
          thePlan.actions.some((a) =>
            a.sql.includes("CREATE OR REPLACE FUNCTION public.pgmq_read"),
          ),
        ).toBe(true);

        // apply as `postgres` too, so the applied wrapper functions end up
        // `postgres`-owned exactly like `branch`'s (production applies run as
        // the non-superuser `postgres` role, never `supabase_admin`).
        const report = await apply(thePlan, mainPg, {
          fingerprintGate: false,
          ...ctx.applyOptions,
        });
        if (report.status !== "applied") {
          throw new Error(
            `apply failed at action ${report.error?.actionIndex ?? "?"}: ${report.error?.message ?? report.status}\nSQL: ${report.error?.sql ?? "(none)"}`,
          );
        }

        // converges: a profile-scoped re-plan against the branch is empty.
        const after = await extractFn(mainPg);
        const drift = plan(after.factBase, d.factBase, ctx.planOptions);
        if (drift.actions.length > 0) {
          throw new Error(
            `${drift.actions.length} drift action(s) after apply:\n${drift.actions.map((a) => a.sql).join("\n")}`,
          );
        }
        expect(drift.actions).toEqual([]);
      } finally {
        await Promise.all([mainPg.end(), branchPg.end()]);
        await Promise.all(dbs.map((db) => db.drop()));
      }
    }, 240_000);

    // A NON-relocatable extension installed into a PRE-EXISTING schema
    // (pg_net into `extensions`, the Supabase baseline shape) must keep its
    // `SCHEMA extensions` clause: the schema is present on the target, so the
    // presence-based create rule emits + orders the clause, and apply converges.
    // (pgmq above pins the mirror case — a self-created schema goes bare.)
    test("non-relocatable extension into a pre-existing schema keeps its SCHEMA clause and converges", async () => {
      const cluster = await supabaseCluster();
      const main = await cluster.createDb("supa_pgnet_main");
      const branch = await cluster.createDb("supa_pgnet_branch");
      try {
        // `extensions` exists on both (Supabase platform schema); only branch
        // installs pg_net into it.
        await main.pool.query(`CREATE SCHEMA IF NOT EXISTS extensions`);
        await branch.pool.query(
          `CREATE SCHEMA IF NOT EXISTS extensions;\n` +
            `CREATE EXTENSION pg_net SCHEMA extensions;`,
        );

        const ctx = await resolveCliProfile(main.pool, "supabase");
        const extractFn = ctx.extract ?? extract;
        const [s, d] = await Promise.all([
          extractFn(main.pool),
          extractFn(branch.pool),
        ]);

        const thePlan = plan(s.factBase, d.factBase, {
          compact: true,
          ...ctx.planOptions,
        });
        expect(
          thePlan.actions.some((a) =>
            a.sql.includes(`CREATE EXTENSION "pg_net" SCHEMA "extensions"`),
          ),
        ).toBe(true);

        const report = await apply(thePlan, main.pool, {
          fingerprintGate: false,
          ...ctx.applyOptions,
        });
        expect(report.status).toBe("applied");

        const after = await extractFn(main.pool);
        const drift = plan(after.factBase, d.factBase, ctx.planOptions);
        expect(drift.actions).toEqual([]);
      } finally {
        await Promise.all([main.drop(), branch.drop()]);
      }
    }, 240_000);

    // pg_net `extnamespace` DRIFT (the extension installed into different
    // schemas on the two sides). pg_net is non-relocatable, so the planner must
    // replace it — and pg_net owns schema `net` plus every `net.*` function
    // (deptype 'e'), the shape that made the replace emit standalone member
    // DROP/CREATE actions and cycle in production ("dependency cycle among 21
    // actions", Sentry event 06bb0a36). The plan must be a clean
    // DROP EXTENSION → CREATE EXTENSION with no `net.*` member actions, and it
    // must apply and converge.
    test("pg_net extnamespace drift replans as a clean extension replace (no member cycle)", async () => {
      const cluster = await supabaseCluster();
      const main = await cluster.createDb("supa_pgnet_drift_main");
      const branch = await cluster.createDb("supa_pgnet_drift_branch");
      try {
        // main: pg_net at its CREATE-time default home (`public`); branch: the
        // Supabase baseline home (`extensions`). Members live in `net` either way.
        await main.pool.query(
          `CREATE SCHEMA IF NOT EXISTS extensions;\n` +
            `CREATE EXTENSION pg_net;`,
        );
        await branch.pool.query(
          `CREATE SCHEMA IF NOT EXISTS extensions;\n` +
            `CREATE EXTENSION pg_net SCHEMA extensions;`,
        );

        const ctx = await resolveCliProfile(main.pool, "supabase");
        const extractFn = ctx.extract ?? extract;
        const [s, d] = await Promise.all([
          extractFn(main.pool),
          extractFn(branch.pool),
        ]);

        const thePlan = plan(s.factBase, d.factBase, {
          compact: true,
          ...ctx.planOptions,
        });
        const sqls = thePlan.actions.map((a) => a.sql);
        const dropAt = sqls.findIndex((sql) =>
          sql.includes(`DROP EXTENSION "pg_net"`),
        );
        const createAt = sqls.findIndex((sql) =>
          sql.includes(`CREATE EXTENSION "pg_net" SCHEMA "extensions"`),
        );
        expect(dropAt).toBeGreaterThanOrEqual(0);
        expect(createAt).toBeGreaterThan(dropAt);
        // members converge via the extension — never their own DROP/CREATE
        expect(sqls.filter((sql) => /FUNCTION "?net"?\./.test(sql))).toEqual(
          [],
        );

        const report = await apply(thePlan, main.pool, {
          fingerprintGate: false,
          ...ctx.applyOptions,
        });
        if (report.status !== "applied") {
          throw new Error(
            `apply failed at action ${report.error?.actionIndex ?? "?"}: ${report.error?.message ?? report.status}\nSQL: ${report.error?.sql ?? "(none)"}`,
          );
        }

        const after = await extractFn(main.pool);
        const drift = plan(after.factBase, d.factBase, ctx.planOptions);
        if (drift.actions.length > 0) {
          throw new Error(
            `${drift.actions.length} drift action(s) after apply:\n${drift.actions.map((a) => a.sql).join("\n")}`,
          );
        }
        expect(drift.actions).toEqual([]);
      } finally {
        await Promise.all([main.drop(), branch.drop()]);
      }
    }, 240_000);

    // RAW-profile variant of the drift test, pinning member-customization
    // replay: an IDENTICAL customization on a member (COMMENT on the member
    // schema `net`, same on both sides) has no delta, yet dies with the
    // replace — the plan must replay it after the re-CREATE or the apply
    // leaves immediate drift. The supabase profile can't see this (Rule 10
    // excludes satellites targeting the `net` system schema), so this runs
    // raw; the Supabase IMAGE is still required for pg_net itself.
    test("pg_net extnamespace drift replays unchanged member customizations (raw profile)", async () => {
      const cluster = await supabaseCluster();
      const main = await cluster.createDb("supa_pgnet_raw_main");
      const branch = await cluster.createDb("supa_pgnet_raw_branch");
      try {
        await main.pool.query(
          `CREATE SCHEMA IF NOT EXISTS extensions;\n` +
            `CREATE EXTENSION pg_net;\n` +
            `COMMENT ON SCHEMA net IS 'pinned by pgdelta test';`,
        );
        await branch.pool.query(
          `CREATE SCHEMA IF NOT EXISTS extensions;\n` +
            `CREATE EXTENSION pg_net SCHEMA extensions;\n` +
            `COMMENT ON SCHEMA net IS 'pinned by pgdelta test';`,
        );

        const [s, d] = await Promise.all([
          extract(main.pool),
          extract(branch.pool),
        ]);
        const thePlan = plan(s.factBase, d.factBase, { compact: true });
        const sqls = thePlan.actions.map((a) => a.sql);
        const createExtAt = sqls.findIndex((sql) =>
          sql.includes(`CREATE EXTENSION "pg_net" SCHEMA "extensions"`),
        );
        const commentAt = sqls.findIndex((sql) =>
          sql.startsWith(`COMMENT ON SCHEMA "net"`),
        );
        expect(createExtAt).toBeGreaterThanOrEqual(0);
        expect(commentAt).toBeGreaterThan(createExtAt);

        const report = await apply(thePlan, main.pool, {
          fingerprintGate: false,
        });
        if (report.status !== "applied") {
          throw new Error(
            `apply failed at action ${report.error?.actionIndex ?? "?"}: ${report.error?.message ?? report.status}\nSQL: ${report.error?.sql ?? "(none)"}`,
          );
        }

        const after = await extract(main.pool);
        const drift = plan(after.factBase, d.factBase);
        if (drift.actions.length > 0) {
          throw new Error(
            `${drift.actions.length} drift action(s) after apply:\n${drift.actions.map((a) => a.sql).join("\n")}`,
          );
        }
        expect(drift.actions).toEqual([]);
      } finally {
        await Promise.all([main.drop(), branch.drop()]);
      }
    }, 240_000);

    // Export-as-source-of-truth on the heavy image, through the FULL CLI
    // pipeline (schema export → schema apply), for a realistic middleware shape:
    // a real extension (pgmq), cross-schema mutual FKs, and multi-role ADP
    // history using the Supabase preset roles (authenticated). The existing
    // supabase tests exercise the DB→diff path; this pins the file-export →
    // reload → converge path the "source of truth" workflow uses.
    //
    // Uses the `raw` profile (no policy) — the real middleware profile is
    // handlers-only; the full supabase POLICY is designed for Supabase's own
    // schema shape, not arbitrary user schemas, so it is the wrong lens here. The
    // Supabase IMAGE is still required for the pgmq extension. (pg_partman is
    // excluded — `create_parent` is imperative, not captured DDL, so it does not
    // round-trip declaratively; pg_cron is excluded because it runs only in the
    // postgres DB, not an isolated shadow — that guard is covered by
    // tests/schema-apply-cron-guard.test.ts.)
    test("schema export → apply round-trips a pgmq + multi-role-ADP + mutual-FK DB and converges", async () => {
      const cluster = await supabaseCluster();
      const source = await cluster.createDb("supa_sot_src");
      const target = await cluster.createDb("supa_sot_tgt");
      const work = mkdtempSync(join(tmpdir(), "pgdelta-supa-sot-"));
      try {
        await source.pool.query(`
          CREATE EXTENSION pgmq;
          SELECT FROM pgmq.create('my_queue');
          CREATE SCHEMA app;
          CREATE SCHEMA ref;
          CREATE TABLE app.orders (id integer PRIMARY KEY, customer_id integer);
          CREATE TABLE ref.customers (id integer PRIMARY KEY, last_order_id integer);
          ALTER TABLE app.orders
            ADD CONSTRAINT fk_cust FOREIGN KEY (customer_id) REFERENCES ref.customers (id);
          ALTER TABLE ref.customers
            ADD CONSTRAINT fk_order FOREIGN KEY (last_order_id) REFERENCES app.orders (id);
          -- multi-role ADP history: t1 predates the grant, t2 inherits it
          CREATE TABLE app.t1 (id integer);
          ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT ON TABLES TO authenticated;
          CREATE TABLE app.t2 (id integer);
          -- a public SECURITY DEFINER wrapper around pgmq + a non-owner grant
          CREATE FUNCTION public.read_queue(q text)
            RETURNS SETOF pgmq.message_record
            LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pgmq'
            AS $fn$ BEGIN RETURN QUERY SELECT * FROM pgmq.read(q, 0, 1); END; $fn$;
          GRANT EXECUTE ON FUNCTION public.read_queue(text) TO authenticated;
        `);

        const dir = join(work, "export");
        await cmdSchemaExport(["--source", source.uri, "--out-dir", dir]);

        // anti-vacuity: the public wrapper must actually be IN the export, or
        // the later convergence assertion proves nothing. This test uses the
        // `raw` profile (no policy, see the comment above), so the supabase
        // profile's Rule 6 owner-exclusion never applies here regardless of
        // which role created these objects — confirmed by this assertion
        // passing without any connection change.
        const exportedFiles = readdirSync(dir, {
          recursive: true,
        }) as string[];
        expect(
          exportedFiles.some((f) => {
            try {
              return readFileSync(join(dir, f), "utf8").includes("read_queue");
            } catch {
              return false; // directory entry, not a file
            }
          }),
        ).toBe(true);

        // apply the exported dir onto a fresh target (co-located shadow), then
        // confirm the re-plan of the applied target against the source is EMPTY
        // — export → load reproduced the source's managed view.
        await cmdSchemaApply([
          "--dir",
          dir,
          "--target",
          target.uri,
          "--renames",
          "off",
        ]);

        const ctx = await resolveCliProfile(source.pool, undefined);
        const [sourceFb, targetFb] = await Promise.all([
          ctx.extract(source.pool).then((r) => r.factBase),
          ctx.extract(target.pool).then((r) => r.factBase),
        ]);
        const drift = plan(targetFb, sourceFb, ctx.planOptions);
        if (drift.actions.length > 0) {
          throw new Error(
            `${drift.actions.length} drift action(s) after export→apply:\n${drift.actions.map((a) => a.sql).join("\n")}`,
          );
        }
        expect(drift.actions).toEqual([]);
      } finally {
        await Promise.all([source.drop(), target.drop()]);
      }
    }, 300_000);
  },
);
