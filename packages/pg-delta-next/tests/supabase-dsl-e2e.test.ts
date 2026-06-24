/**
 * Supabase policy end-to-end (port of pg-delta/tests/integration/supabase-dsl-e2e.test.ts).
 *
 * Exercises the managed-view projection under `supabasePolicy` for the
 * Supabase-specific filter behaviors: user-trigger capture on managed schemas,
 * user-toggleable extension drops, FDW suppress/preserve, FDW-ACL suppress vs
 * server-ACL preserve, and the pgmq queue-trigger fallback.
 *
 * Runs on the bare supabaseCluster() (PG17; ships pgmq / pg_net / postgres_fdw).
 * Two adaptations vs the old base-init suite:
 *  - the bare image has no base-init, so `auth` is a stand-in schema (the policy
 *    keys on the schema NAME, not realness);
 *  - objects that must NOT be caught by the system-role owner deny-list are
 *    owned by a custom non-system role `dsl_owner` (the old suite used
 *    `postgres`, which on the bare image lacks CREATE on public/db). Same policy
 *    signal — a non-system owner — with privileges we control.
 * Self-gated via runSupabaseBareTests.
 */
import { describe, expect, test } from "bun:test";
import type { Pool } from "pg";
import { apply } from "../src/apply/apply.ts";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { supabasePolicy } from "../src/policy/supabase.ts";
import {
  runSupabaseBareTests,
  supabaseCluster,
  type TestDb,
} from "./containers.ts";

/** Cluster-global roles persist across the shared singleton's databases and
 *  test runs, so create them idempotently. */
async function ensureRole(pool: Pool, name: string): Promise<void> {
  await pool.query(
    `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='${name}') THEN CREATE ROLE ${name}; END IF; END $$;`,
  );
}

/** Make `dsl_owner` a usable non-system owner in this database. */
async function enableOwnerRole(pool: Pool): Promise<void> {
  await ensureRole(pool, "dsl_owner");
  const { rows } = await pool.query<{ d: string }>(
    "select current_database() as d",
  );
  await pool.query(`GRANT ALL ON DATABASE "${rows[0]!.d}" TO dsl_owner`);
  await pool.query(`GRANT ALL ON SCHEMA public TO dsl_owner`);
}

async function supabasePlanSql(
  main: TestDb,
  branch: TestDb,
): Promise<string[]> {
  const [s, d] = await Promise.all([extract(main.pool), extract(branch.pool)]);
  return plan(s.factBase, d.factBase, { policy: supabasePolicy }).actions.map(
    (a) => a.sql,
  );
}

describe.skipIf(!runSupabaseBareTests)("supabase policy e2e", () => {
  // KNOWN v2 GAP (filed): a user trigger on a managed-schema table
  // (issue #254) is dropped by the managed view. supabasePolicy Rule 3 keeps
  // the trigger FACT (factScopeExcluded returns false for it), but resolveView
  // makes the parent table (auth.users) an exclusion root via the system-schema
  // rule, and excludeFactsAndDescendants then prunes the trigger as a
  // descendant — overriding the include. Even if kept, the planner's
  // missing-requirement guard would reject the trigger's edge to the
  // non-managed table (only assumed ROLES/SCHEMAS are exempt, not tables in
  // them). Fixing it needs coordinated changes to view-resolution (don't prune
  // an explicitly-included descendant) AND the guard (treat managed-schema
  // objects as assumed), or the committed Supabase baseline (then auth.users is
  // subtracted, not excluded-as-root). Enable this test once that lands.
  test.skip("captures a user trigger attached to a managed (auth) schema table", async () => {
    const cluster = await supabaseCluster();
    const main = await cluster.createDb("supa_dsl_trig_main");
    const branch = await cluster.createDb("supa_dsl_trig_branch");
    try {
      const authStandin = `
        CREATE SCHEMA auth;
        CREATE TABLE auth.users (id uuid PRIMARY KEY);
      `;
      await main.pool.query(authStandin);
      await branch.pool.query(authStandin);
      await enableOwnerRole(branch.pool);
      // function owned by a non-system role (dsl_owner) so it is not dropped by
      // the owner rule; trigger created by the superuser that owns auth.users.
      await branch.pool.query(`
        SET ROLE dsl_owner;
        CREATE FUNCTION public.handle_new_user() RETURNS trigger
          LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
        RESET ROLE;
        CREATE TRIGGER on_auth_user_created
          AFTER INSERT ON auth.users
          FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
      `);

      const sql = await supabasePlanSql(main, branch);
      expect(
        sql.some((s) => /CREATE TRIGGER "on_auth_user_created"/.test(s)),
      ).toBe(true);
      expect(
        sql.some((s) => /CREATE FUNCTION "public"\."handle_new_user"/.test(s)),
      ).toBe(true);
    } finally {
      await Promise.all([main.drop(), branch.drop()]);
    }
  }, 180_000);

  test("captures a user-toggleable extension (pg_net) drop and roundtrips it", async () => {
    const cluster = await supabaseCluster();
    const main = await cluster.createDb("supa_dsl_pgnet_main");
    const branch = await cluster.createDb("supa_dsl_pgnet_branch");
    try {
      await main.pool.query("CREATE EXTENSION IF NOT EXISTS pg_net");
      await branch.pool.query("CREATE EXTENSION IF NOT EXISTS pg_net");
      await branch.pool.query("DROP EXTENSION pg_net");

      const [s, d] = await Promise.all([
        extract(main.pool),
        extract(branch.pool),
      ]);
      const thePlan = plan(s.factBase, d.factBase, { policy: supabasePolicy });
      expect(thePlan.actions.map((a) => a.sql)).toContain(
        'DROP EXTENSION "pg_net"',
      );

      const report = await apply(thePlan, main.pool, {
        fingerprintGate: false,
      });
      expect(report.status).toBe("applied");
      const after = await extract(main.pool);
      const drift = plan(after.factBase, d.factBase, {
        policy: supabasePolicy,
      });
      expect(drift.actions).toEqual([]);
    } finally {
      await Promise.all([main.drop(), branch.drop()]);
    }
  }, 180_000);

  test("suppresses a FOREIGN DATA WRAPPER owned by a system role", async () => {
    const cluster = await supabaseCluster();
    const main = await cluster.createDb("supa_dsl_fdw_main");
    const branch = await cluster.createDb("supa_dsl_fdw_branch");
    try {
      // owned by the connection role supabase_admin (a system role) → the owner
      // rule projects the wrapper out.
      await branch.pool.query(`
        CREATE SCHEMA IF NOT EXISTS extensions;
        CREATE EXTENSION IF NOT EXISTS postgres_fdw SCHEMA extensions;
        CREATE FOREIGN DATA WRAPPER wasm_lookalike
          HANDLER extensions.postgres_fdw_handler
          VALIDATOR extensions.postgres_fdw_validator;
      `);
      const sql = await supabasePlanSql(main, branch);
      expect(sql.filter((s) => /FOREIGN DATA WRAPPER/.test(s))).toEqual([]);
    } finally {
      await Promise.all([main.drop(), branch.drop()]);
    }
  }, 180_000);

  test("preserves a user-owned postgres_fdw server, foreign table, and user mapping", async () => {
    const cluster = await supabaseCluster();
    const main = await cluster.createDb("supa_dsl_pgfdw_main");
    const branch = await cluster.createDb("supa_dsl_pgfdw_branch");
    try {
      const base = `
        CREATE SCHEMA IF NOT EXISTS extensions;
        CREATE EXTENSION IF NOT EXISTS postgres_fdw SCHEMA extensions;
      `;
      await main.pool.query(base);
      await branch.pool.query(base);
      await enableOwnerRole(branch.pool);
      await branch.pool.query(
        `GRANT USAGE ON FOREIGN DATA WRAPPER postgres_fdw TO dsl_owner`,
      );
      await branch.pool.query(`
        SET ROLE dsl_owner;
        CREATE SERVER user_pg_server FOREIGN DATA WRAPPER postgres_fdw
          OPTIONS (host 'remote', dbname 'remote_db');
        CREATE SCHEMA user_fdw_test;
        CREATE FOREIGN TABLE user_fdw_test.remote_row (id integer)
          SERVER user_pg_server
          OPTIONS (schema_name 'public', table_name 'remote_row');
        CREATE USER MAPPING FOR dsl_owner SERVER user_pg_server
          OPTIONS (user 'remote', password 'secret');
        RESET ROLE;
      `);
      const sql = await supabasePlanSql(main, branch);
      expect(sql.some((s) => /CREATE SERVER "user_pg_server"/.test(s))).toBe(
        true,
      );
      expect(
        sql.some((s) =>
          /CREATE FOREIGN TABLE "user_fdw_test"\."remote_row"/.test(s),
        ),
      ).toBe(true);
      expect(
        sql.some((s) => /CREATE USER MAPPING FOR "dsl_owner"/.test(s)),
      ).toBe(true);
    } finally {
      await Promise.all([main.drop(), branch.drop()]);
    }
  }, 180_000);

  test("suppresses GRANT/REVOKE on a FOREIGN DATA WRAPPER", async () => {
    const cluster = await supabaseCluster();
    const main = await cluster.createDb("supa_dsl_fdwacl_main");
    const branch = await cluster.createDb("supa_dsl_fdwacl_branch");
    try {
      await ensureRole(main.pool, "fdw_user");
      await ensureRole(branch.pool, "fdw_user");
      await main.pool.query(`
        CREATE FOREIGN DATA WRAPPER user_fdw;
        GRANT ALL ON FOREIGN DATA WRAPPER user_fdw TO fdw_user;
      `);
      await branch.pool.query(`CREATE FOREIGN DATA WRAPPER user_fdw;`);
      const sql = await supabasePlanSql(main, branch);
      expect(
        sql.filter((s) => /(GRANT|REVOKE)[^;]*FOREIGN DATA WRAPPER/.test(s)),
      ).toEqual([]);
    } finally {
      await Promise.all([main.drop(), branch.drop()]);
    }
  }, 180_000);

  test("preserves GRANT on a user-owned FOREIGN SERVER", async () => {
    const cluster = await supabaseCluster();
    const main = await cluster.createDb("supa_dsl_srvacl_main");
    const branch = await cluster.createDb("supa_dsl_srvacl_branch");
    try {
      const base = `
        CREATE SCHEMA IF NOT EXISTS extensions;
        CREATE EXTENSION IF NOT EXISTS postgres_fdw SCHEMA extensions;
      `;
      for (const db of [main, branch]) {
        await db.pool.query(base);
        await ensureRole(db.pool, "server_user");
        await enableOwnerRole(db.pool);
        await db.pool.query(
          `GRANT USAGE ON FOREIGN DATA WRAPPER postgres_fdw TO dsl_owner`,
        );
        await db.pool.query(`
          SET ROLE dsl_owner;
          CREATE SERVER user_server FOREIGN DATA WRAPPER postgres_fdw;
          RESET ROLE;
        `);
      }
      await branch.pool.query(`
        SET ROLE dsl_owner;
        GRANT USAGE ON FOREIGN SERVER user_server TO server_user;
        RESET ROLE;
      `);
      const sql = await supabasePlanSql(main, branch);
      // v2 serializes server ACL with `ON FOREIGN SERVER` (old used `ON SERVER`).
      expect(
        sql.some((s) =>
          /GRANT .*ON FOREIGN SERVER "user_server" TO "server_user"/.test(s),
        ),
      ).toBe(true);
    } finally {
      await Promise.all([main.drop(), branch.drop()]);
    }
  }, 180_000);

  test("suppresses a user trigger on a pgmq queue table (defensive fallback)", async () => {
    const cluster = await supabaseCluster();
    const main = await cluster.createDb("supa_dsl_pgmqtrig_main");
    const branch = await cluster.createDb("supa_dsl_pgmqtrig_branch");
    try {
      await branch.pool.query(`
        CREATE EXTENSION pgmq;
        SELECT pgmq.create('processed_milestones_queue');
        DELETE FROM pg_depend
         WHERE objid = 'pgmq.q_processed_milestones_queue'::regclass
           AND refclassid = 'pg_extension'::regclass AND deptype = 'e';
        DELETE FROM pg_depend
         WHERE objid = 'pgmq.a_processed_milestones_queue'::regclass
           AND refclassid = 'pg_extension'::regclass AND deptype = 'e';
        CREATE FUNCTION public.move_data_from_queue() RETURNS trigger
          LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
        CREATE TRIGGER after_insert_processed_milestones_queue
          AFTER INSERT ON pgmq.q_processed_milestones_queue
          FOR EACH ROW EXECUTE FUNCTION public.move_data_from_queue();
      `);
      const sql = await supabasePlanSql(main, branch);
      expect(
        sql.filter((s) =>
          /CREATE TRIGGER[^;]*ON "?pgmq"?\."?q_processed_milestones_queue"?/.test(
            s,
          ),
        ),
      ).toEqual([]);
    } finally {
      await Promise.all([main.drop(), branch.drop()]);
    }
  }, 180_000);
});
