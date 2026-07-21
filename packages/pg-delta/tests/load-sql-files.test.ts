/** Stage-7 shadow loader: ordering convergence + the rejection behaviors. */
import { describe, expect, test } from "bun:test";
import {
  loadSqlFiles,
  ShadowLoadError,
} from "../src/frontends/load-sql-files.ts";

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}
import { plan } from "../src/plan/plan.ts";
import { provePlan } from "../src/proof/prove.ts";
import { extract, type ExtractOptions } from "../src/extract/extract.ts";
import { createTestDb, isolatedClusterPair } from "./containers.ts";

describe("loadSqlFiles (shadow frontend)", () => {
  test("out-of-order files converge via bounded rounds", async () => {
    const shadow = await createTestDb("shadow");
    try {
      // lexicographic order is wrong on purpose: the view file sorts first
      const result = await loadSqlFiles(
        [
          {
            name: "01_view.sql",
            sql: "CREATE VIEW public.v AS SELECT id FROM public.t;",
          },
          {
            name: "02_table.sql",
            sql: "CREATE TABLE public.t (id integer PRIMARY KEY);",
          },
        ],
        shadow.pool,
      );
      expect(result.rounds).toBeGreaterThan(1);
      expect(
        result.factBase.has({ kind: "view", schema: "public", name: "v" }),
      ).toBe(true);
    } finally {
      await shadow.drop();
    }
  }, 60_000);

  test("a stuck load names the offending statement (line + excerpt)", async () => {
    const shadow = await createTestDb("shadow");
    try {
      // one file that can never apply (references a relation nothing creates):
      // the load gets stuck and must report WHICH statement failed, not just the
      // file name + bare PG message — the failing line and a short excerpt.
      const err = await captureError(
        loadSqlFiles(
          [
            {
              name: "01_view.sql",
              sql: "CREATE VIEW public.v AS\n  SELECT id FROM public.missing_table;",
            },
          ],
          shadow.pool,
        ),
      );
      expect(err).toBeInstanceOf(ShadowLoadError);
      const detail = (err as ShadowLoadError).details
        .map((d) => d.message)
        .join("\n");
      // the statement's location + excerpt, derived from the PG error position
      expect(detail).toMatch(/at line \d+:/);
      expect(detail).toContain("SELECT id FROM public.missing_table");
    } finally {
      await shadow.drop();
    }
  }, 60_000);

  test("a deep dependency chain converges (rounds scale with depth, not the old 25 cap)", async () => {
    // A linear chain of 30 views, each selecting from the next, with the base
    // table last — and files named so lexicographic order is EXACTLY reverse
    // dependency order. Round k resolves exactly one file, so it needs ~30
    // rounds. The old fixed maxRounds=25 fails this with "did not converge"
    // even though it was making steady progress; the cap must scale with the
    // file count so dependency depth is never an artificial ceiling.
    const DEPTH = 30;
    const shadow = await createTestDb("shadow");
    try {
      const files = [];
      for (let k = 0; k < DEPTH - 1; k++) {
        files.push({
          name: `${String(k).padStart(2, "0")}_v${k}.sql`,
          sql: `CREATE VIEW public.v${k} AS SELECT * FROM public.v${k + 1};`,
        });
      }
      files.push({
        name: `${String(DEPTH - 1).padStart(2, "0")}_v${DEPTH - 1}.sql`,
        sql: `CREATE TABLE public.v${DEPTH - 1} (id integer);`,
      });

      const result = await loadSqlFiles(files, shadow.pool);
      expect(result.rounds).toBeGreaterThanOrEqual(DEPTH);
      expect(
        result.factBase.has({ kind: "view", schema: "public", name: "v0" }),
      ).toBe(true);
    } finally {
      await shadow.drop();
    }
  }, 120_000);

  test("honors a caller-supplied extractor (profile-aware shadow projection)", async () => {
    // schema apply passes its profile's ctx.extract so the shadow desired state
    // is projected with the same handlers as the target (review P1). Verify the
    // option is actually used: a custom extractor is invoked with the shadow
    // pool and the sqlFiles provenance, and its result is returned verbatim.
    const shadow = await createTestDb("shadow");
    try {
      let calledWith: ExtractOptions | undefined;
      const customExtract = (
        pool: typeof shadow.pool,
        options?: ExtractOptions,
      ): ReturnType<typeof extract> => {
        calledWith = options;
        return extract(pool, options);
      };
      const result = await loadSqlFiles(
        [
          {
            name: "01_table.sql",
            sql: "CREATE TABLE public.t (id integer PRIMARY KEY);",
          },
        ],
        shadow.pool,
        { extract: customExtract },
      );
      expect(calledWith).toEqual({ source: "sqlFiles" });
      expect(
        result.factBase.has({ kind: "table", schema: "public", name: "t" }),
      ).toBe(true);
    } finally {
      await shadow.drop();
    }
  }, 60_000);

  test("range type used by a table orders correctly from shuffled files (#282)", async () => {
    const shadow = await createTestDb("shadow");
    try {
      // the exact shuffle from supabase/pg-toolbelt#282: a table using a
      // RANGE type before the type, before the schema. pg-topo classified
      // CREATE TYPE AS RANGE as UNKNOWN and could not order it; the new
      // engine's shadow loader resolves it by bounded rounds (no parser).
      const result = await loadSqlFiles(
        [
          {
            name: "0_bookings.sql",
            sql: "CREATE TABLE app.bookings (id int PRIMARY KEY, span app.int_range NOT NULL);",
          },
          {
            name: "1_range.sql",
            sql: "CREATE TYPE app.int_range AS RANGE (subtype = int4);",
          },
          { name: "2_schema.sql", sql: "CREATE SCHEMA app;" },
        ],
        shadow.pool,
      );
      expect(result.rounds).toBeGreaterThan(1);
      expect(
        result.factBase.has({ kind: "type", schema: "app", name: "int_range" }),
      ).toBe(true);
      expect(
        result.factBase.has({ kind: "table", schema: "app", name: "bookings" }),
      ).toBe(true);
      // the column→type dependency edge resolved (span references int_range)
      const edges = result.factBase.edges.map(
        (e) => `${e.from.kind}->${e.to.kind}`,
      );
      expect(edges).toContain("column->type");
    } finally {
      await shadow.drop();
    }
  }, 60_000);

  test("unorderable input fails loudly with stuck statements, before extraction", async () => {
    const shadow = await createTestDb("shadow");
    try {
      const error = await captureError(
        loadSqlFiles(
          [
            {
              name: "broken.sql",
              sql: "CREATE VIEW public.v AS SELECT * FROM public.ghost;",
            },
          ],
          shadow.pool,
        ),
      );
      expect(error).toBeInstanceOf(ShadowLoadError);
      expect(String(error)).toMatch(/stuck/);
    } finally {
      await shadow.drop();
    }
  }, 60_000);

  test("DML is rejected by observation, not parsing", async () => {
    const shadow = await createTestDb("shadow");
    try {
      const error = await captureError(
        loadSqlFiles(
          [
            {
              name: "schema.sql",
              sql: "CREATE TABLE public.t (id integer); INSERT INTO public.t VALUES (1);",
            },
          ],
          shadow.pool,
        ),
      );
      expect(error).toBeInstanceOf(ShadowLoadError);
      expect(String(error)).toMatch(/data statements/);
    } finally {
      await shadow.drop();
    }
  }, 60_000);

  test("role-creating files are rejected in database-scratch mode", async () => {
    const shadow = await createTestDb("shadow");
    try {
      const error = await captureError(
        loadSqlFiles(
          [{ name: "roles.sql", sql: "CREATE ROLE shadow_leak_test NOLOGIN;" }],
          shadow.pool,
        ),
      );
      expect(error).toBeInstanceOf(ShadowLoadError);
      expect(String(error)).toMatch(/cluster-level/);
    } finally {
      await shadow.pool
        .query("DROP ROLE IF EXISTS shadow_leak_test")
        .catch(() => {});
      await shadow.drop();
    }
  }, 60_000);

  test("typo'd function body is caught by re-validation", async () => {
    const shadow = await createTestDb("shadow");
    try {
      const error = await captureError(
        loadSqlFiles(
          [
            {
              name: "fn.sql",
              sql: `CREATE FUNCTION public.broken() RETURNS integer LANGUAGE sql AS 'SELECT id FROM public.missing_table';`,
            },
          ],
          shadow.pool,
          // A user-routine body-lint is a WARNING by default now (lenient
          // function bodies); the fatal re-validation throw is gated on the
          // strictFunctionBodies opt-in.
          { strictFunctionBodies: true },
        ),
      );
      expect(error).toBeInstanceOf(ShadowLoadError);
      const detail = (error as ShadowLoadError).details.find(
        (d) => d.code === "invalid_routine_body",
      );
      expect(detail).toBeDefined();
      expect(detail?.severity).toBe("error");
    } finally {
      await shadow.drop();
    }
  }, 60_000);

  test("declarative end-to-end: files -> shadow -> plan -> prove against a live target", async () => {
    const shadow = await createTestDb("shadow");
    const target = await createTestDb("target");
    try {
      await target.pool.query("CREATE TABLE public.old_stuff (id integer)");
      const loaded = await loadSqlFiles(
        [
          {
            name: "schema.sql",
            sql: `CREATE TABLE public.users (id integer PRIMARY KEY, email text NOT NULL);
                  CREATE INDEX users_email_idx ON public.users (email);`,
          },
        ],
        shadow.pool,
      );
      const current = await extract(target.pool);
      const thePlan = plan(current.factBase, loaded.factBase);
      const clone = await target.clone();
      try {
        const verdict = await provePlan(thePlan, clone.pool, loaded.factBase);
        expect(verdict.applyError).toBeUndefined();
        expect(verdict.driftDeltas).toEqual([]);
        expect(verdict.ok).toBe(true);
      } finally {
        await clone.drop();
      }
    } finally {
      await Promise.all([shadow.drop(), target.drop()]);
    }
  }, 120_000);

  // ── Gap 1: isolatedCluster mode ──────────────────────────────────────────

  test("isolatedCluster mode: role-creating file loads successfully", async () => {
    const [clusterA] = await isolatedClusterPair();
    const shadow = await clusterA.createDb("shadow_iso");
    const baselineRoles = await clusterA.listRoles();
    try {
      const result = await loadSqlFiles(
        [{ name: "roles.sql", sql: "CREATE ROLE iso_role_test NOLOGIN;" }],
        shadow.pool,
        { mode: "isolatedCluster" },
      );
      // loading must succeed without throwing
      expect(result.rounds).toBeGreaterThanOrEqual(1);
    } finally {
      await clusterA.dropRolesExcept(baselineRoles);
      await shadow.drop();
    }
  }, 60_000);

  test("isolatedCluster mode: same role-creating file FAILS in databaseScratch mode and leaks no role", async () => {
    const shadow = await createTestDb("shadow_scratch");
    try {
      const error = await captureError(
        loadSqlFiles(
          [
            {
              name: "roles.sql",
              sql: "CREATE ROLE scratch_role_leak_test NOLOGIN;",
            },
          ],
          shadow.pool,
          { mode: "databaseScratch" },
        ),
      );
      expect(error).toBeInstanceOf(ShadowLoadError);
      expect(String(error)).toMatch(/cluster-level/);
      // the role must NOT survive on the shared cluster after the failed load
      const present = await shadow.pool.query(
        "SELECT 1 FROM pg_roles WHERE rolname = 'scratch_role_leak_test'",
      );
      expect(present.rows.length).toBe(0);
    } finally {
      await shadow.pool
        .query("DROP ROLE IF EXISTS scratch_role_leak_test")
        .catch(() => {});
      await shadow.drop();
    }
  }, 60_000);

  test("databaseScratch mode: role file + non-converging file FAILS and leaks no role", async () => {
    const shadow = await createTestDb("shadow_scratch_multi");
    try {
      const error = await captureError(
        loadSqlFiles(
          [
            { name: "roles.sql", sql: "CREATE ROLE leak_x NOLOGIN;" },
            {
              name: "broken.sql",
              sql: "CREATE TABLE public.t (c integer REFERENCES public.does_not_exist);",
            },
          ],
          shadow.pool,
          { mode: "databaseScratch" },
        ),
      );
      expect(error).toBeInstanceOf(ShadowLoadError);
      // the role must NOT survive on the shared cluster after the failed load
      const present = await shadow.pool.query(
        "SELECT 1 FROM pg_roles WHERE rolname = 'leak_x'",
      );
      expect(present.rows.length).toBe(0);
    } finally {
      await shadow.pool.query("DROP ROLE IF EXISTS leak_x").catch(() => {});
      await shadow.drop();
    }
  }, 60_000);

  test("databaseScratch mode: DO-block CREATE ROLE evades preflight but the leaked role is restored", async () => {
    const shadow = await createTestDb("shadow_scratch_doblock");
    try {
      const error = await captureError(
        loadSqlFiles(
          [
            {
              name: "doblock.sql",
              sql: "DO $$ BEGIN EXECUTE 'CREATE ROLE do_block_leak NOLOGIN'; END $$;",
            },
          ],
          shadow.pool,
          { mode: "databaseScratch" },
        ),
      );
      expect(error).toBeInstanceOf(ShadowLoadError);
      expect(String(error)).toMatch(/cluster-level/);
      // the DO-block committed the role; the restore net must have dropped it
      const present = await shadow.pool.query(
        "SELECT 1 FROM pg_roles WHERE rolname = 'do_block_leak'",
      );
      expect(present.rows.length).toBe(0);
    } finally {
      await shadow.pool
        .query("DROP ROLE IF EXISTS do_block_leak")
        .catch(() => {});
      await shadow.drop();
    }
  }, 60_000);

  // ── Gap 2: pg_auth_members leak detection ────────────────────────────────

  test("pg_auth_members leak: GRANT between pre-existing roles is detected in databaseScratch mode", async () => {
    // We need two pre-existing roles on the shared cluster.
    // Create them ahead of time, then attempt a GRANT in a file.
    const shadow = await createTestDb("shadow_membership");
    const sharedPool = shadow.cluster.adminPool;

    // Set up two roles on the shared cluster before loading
    await sharedPool
      .query("CREATE ROLE membership_role_a NOLOGIN")
      .catch(() => {});
    await sharedPool
      .query("CREATE ROLE membership_role_b NOLOGIN")
      .catch(() => {});

    try {
      const error = await captureError(
        loadSqlFiles(
          [
            {
              name: "grant.sql",
              // GRANT role_a TO role_b adds a pg_auth_members row without creating a new role
              sql: "GRANT membership_role_a TO membership_role_b;",
            },
          ],
          shadow.pool,
          { mode: "databaseScratch" },
        ),
      );
      expect(error).toBeInstanceOf(ShadowLoadError);
      // Must mention cluster-level or membership leak
      expect(String(error)).toMatch(/cluster-level|membership/i);
    } finally {
      await sharedPool
        .query("DROP ROLE IF EXISTS membership_role_b")
        .catch(() => {});
      await sharedPool
        .query("DROP ROLE IF EXISTS membership_role_a")
        .catch(() => {});
      await shadow.drop();
    }
  }, 60_000);

  // ── Gap 3: provenance tag ────────────────────────────────────────────────

  test("provenance: loaded factBase.source === 'sqlFiles'", async () => {
    const shadow = await createTestDb("shadow_provenance");
    try {
      const result = await loadSqlFiles(
        [
          {
            name: "schema.sql",
            sql: "CREATE TABLE public.prov_test (id integer PRIMARY KEY);",
          },
        ],
        shadow.pool,
      );
      expect(result.factBase.source).toBe("sqlFiles");
    } finally {
      await shadow.drop();
    }
  }, 60_000);

  // ── Gap 4: mutual-FK split diagnostic ───────────────────────────────────

  test("mutual-FK: two tables referencing each other inline get a split-FK hint", async () => {
    const shadow = await createTestDb("shadow_mutualfk");
    try {
      // a.sql creates table_a referencing table_b; b.sql creates table_b referencing table_a
      // Neither can load first because the other doesn't exist yet.
      const error = await captureError(
        loadSqlFiles(
          [
            {
              name: "a.sql",
              sql: `CREATE TABLE public.table_a (
                id integer PRIMARY KEY,
                b_id integer REFERENCES public.table_b(id)
              );`,
            },
            {
              name: "b.sql",
              sql: `CREATE TABLE public.table_b (
                id integer PRIMARY KEY,
                a_id integer REFERENCES public.table_a(id)
              );`,
            },
          ],
          shadow.pool,
        ),
      );
      expect(error).toBeInstanceOf(ShadowLoadError);
      const msg = String(error);
      expect(msg).toMatch(/stuck/);
      // Must include the split-FK remediation hint
      expect(msg).toMatch(/ALTER TABLE|split/i);
    } finally {
      await shadow.drop();
    }
  }, 60_000);
});
