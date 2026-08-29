/**
 * User RLS policies on the storage / realtime allowlist surfaces
 * (SUPABASE_USER_POLICY_SURFACES, mirroring the platform's
 * `supautils.policy_grants`) must survive the supabase managed-schema filter,
 * export as TABLE_SCOPED satellites of a reference-only parent (no CREATE
 * TABLE), and round-trip through plan → apply → re-diff. Comments ON those
 * policies are user intent too and must round-trip with them (REAL-997).
 * The `auth` schema is covered SCHEMA-WIDE (Auth-team guarantee 2026-08-29:
 * the service never ships or manages RLS policies on its own tables).
 *
 * `createDb()` on the shared supabase cluster is an empty database (template1),
 * not a copy of the image's `postgres` catalog — stand-in tables named like the
 * platform surfaces exercise the policy the same way the auth.users trigger
 * tests do. The pristine guard boots a standalone bare image and replays
 * `applySupabaseBaseInit` there — `createDb()` is empty template1, so the
 * fixture (a bare→full-stack delta) cannot replay into it, and extracting the
 * shared cluster `postgres` catalog is vacuous (those tables are not created
 * until service migrations).
 *
 * Self-gated via runSupabaseBareTests.
 */
import { afterAll, describe, expect, test } from "bun:test";
import pg from "pg";
import { apply } from "../src/apply/apply.ts";
import type { StableId } from "../src/core/stable-id.ts";
import { extract } from "../src/extract/extract.ts";
import { exportSqlFiles } from "../src/frontends/export-sql-files.ts";
import { plan } from "../src/plan/plan.ts";
import { flattenPolicy, resolveView } from "../src/policy/policy.ts";
import {
  SUPABASE_USER_POLICY_SURFACES,
  supabasePolicy,
} from "../src/policy/supabase.ts";
import {
  runSupabaseBareTests,
  startStandaloneSupabase,
  supabaseCluster,
  type TestDb,
} from "./containers.ts";
import { applySupabaseBaseInit } from "./supabase-base-init.ts";

const dbs: TestDb[] = [];
afterAll(async () => {
  await Promise.all(dbs.map((d) => d.drop().catch(() => {})));
});

const ALLOWLIST = SUPABASE_USER_POLICY_SURFACES;

const STANDIN_SURFACES = `
  CREATE SCHEMA IF NOT EXISTS storage;
  CREATE TABLE IF NOT EXISTS storage.objects (
    id uuid PRIMARY KEY,
    bucket_id text,
    name text,
    owner uuid
  );
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  CREATE TABLE IF NOT EXISTS storage.buckets (
    id text PRIMARY KEY,
    name text
  );
  ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;
  CREATE TABLE IF NOT EXISTS storage.buckets_analytics (
    id text PRIMARY KEY
  );
  ALTER TABLE storage.buckets_analytics ENABLE ROW LEVEL SECURITY;
  CREATE TABLE IF NOT EXISTS storage.s3_multipart_uploads (
    id text PRIMARY KEY,
    bucket_id text
  );
  ALTER TABLE storage.s3_multipart_uploads ENABLE ROW LEVEL SECURITY;
  CREATE TABLE IF NOT EXISTS storage.s3_multipart_uploads_parts (
    id uuid PRIMARY KEY,
    upload_id text
  );
  ALTER TABLE storage.s3_multipart_uploads_parts ENABLE ROW LEVEL SECURITY;
  CREATE SCHEMA IF NOT EXISTS realtime;
  CREATE TABLE IF NOT EXISTS realtime.messages (
    id uuid PRIMARY KEY,
    topic text
  );
  ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
  CREATE TABLE IF NOT EXISTS realtime.subscription (
    id bigint PRIMARY KEY,
    subscription_id uuid
  );
  ALTER TABLE realtime.subscription ENABLE ROW LEVEL SECURITY;
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE TABLE IF NOT EXISTS auth.users (
    id uuid PRIMARY KEY,
    email text
  );
  ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;
  CREATE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
`;

const OBJECTS_POLICY = `
  CREATE POLICY "Users can read own objects" ON storage.objects
    FOR SELECT TO authenticated
    USING (bucket_id = 'x');
`;

const OBJECTS_POLICY_EDITED = `
  DROP POLICY "Users can read own objects" ON storage.objects;
  CREATE POLICY "Users can read own objects" ON storage.objects
    FOR SELECT TO authenticated
    USING (bucket_id = 'y');
`;

const MESSAGES_POLICY = `
  CREATE POLICY "authenticated can read messages" ON realtime.messages
    FOR SELECT TO authenticated
    USING (true);
`;

const AUTH_UID_POLICY = `
  CREATE POLICY "owner can read" ON storage.objects
    FOR SELECT TO authenticated
    USING (owner = auth.uid());
`;

const SUBSCRIPTION_POLICY = `
  CREATE POLICY "authenticated can read subscriptions" ON realtime.subscription
    FOR SELECT TO authenticated
    USING (true);
`;

const AUTH_USERS_POLICY = `
  CREATE POLICY "own row only" ON auth.users
    FOR SELECT TO authenticated
    USING (id = auth.uid());
`;

const OBJECTS_POLICY_WITH_COMMENT = `
  ${OBJECTS_POLICY}
  COMMENT ON POLICY "Users can read own objects" ON storage.objects
    IS 'customer note';
`;

const flat = flattenPolicy(supabasePolicy);

async function makeDb(prefix: string, sql?: string): Promise<TestDb> {
  const cluster = await supabaseCluster();
  const db = await cluster.createDb(prefix);
  dbs.push(db);
  await db.pool.query(STANDIN_SURFACES);
  if (sql !== undefined) await db.pool.query(sql);
  return db;
}

function planSql(source: TestDb, desired: TestDb) {
  return Promise.all([extract(source.pool), extract(desired.pool)]).then(
    ([s, d]) =>
      plan(s.factBase, d.factBase, { policy: supabasePolicy }).actions.map(
        (a) => a.sql,
      ),
  );
}

function isAllowlistPolicy(id: StableId): boolean {
  return (
    id.kind === "policy" &&
    ALLOWLIST.some((s) => s.schema === id.schema && s.table === id.table)
  );
}

function isAllowlistTable(id: StableId): boolean {
  return (
    id.kind === "table" &&
    ALLOWLIST.some((s) => s.schema === id.schema && s.table === id.name)
  );
}

describe.skipIf(!runSupabaseBareTests)(
  "supabase profile: user RLS on managed-schema surfaces",
  () => {
    test("pristine image seeds no policies on the allowlist surfaces", async () => {
      const stack = await startStandaloneSupabase();
      const pool = new pg.Pool({
        connectionString: stack.connectionUri("postgres"),
        max: 3,
      });
      try {
        await applySupabaseBaseInit(pool);
        const { factBase } = await extract(pool);
        const tables = factBase
          .facts()
          .filter((fct) => isAllowlistTable(fct.id))
          .map((fct) =>
            fct.id.kind === "table" ? `${fct.id.schema}.${fct.id.name}` : "",
          )
          .sort();
        expect(tables).toEqual(
          [...ALLOWLIST].map((s) => `${s.schema}.${s.table}`).sort(),
        );
        const seeded = factBase
          .facts()
          .filter((fct) => isAllowlistPolicy(fct.id))
          .map((fct) => fct.id);
        expect(seeded).toEqual([]);

        // auth is covered SCHEMA-WIDE (Auth-team guarantee: the service never
        // ships policies on its own tables) — pin that the base init seeds
        // zero policies anywhere in auth, and that the tables are there for
        // the guarantee to be about.
        const authTables = factBase
          .facts()
          .filter((fct) => fct.id.kind === "table" && fct.id.schema === "auth")
          .map((fct) => (fct.id.kind === "table" ? fct.id.name : ""));
        expect(authTables).toContain("users");
        const authPolicies = factBase
          .facts()
          .filter((fct) => fct.id.kind === "policy" && fct.id.schema === "auth")
          .map((fct) => fct.id);
        expect(authPolicies).toEqual([]);
      } finally {
        await pool.end();
        await stack.stop();
      }
    }, 180_000);

    test("diff/apply/converge creates and drops a storage.objects policy", async () => {
      const without = await makeDb("pol_obj_wo");
      const withPolicy = await makeDb("pol_obj_w", OBJECTS_POLICY);

      const [withoutState, withState] = await Promise.all([
        extract(without.pool),
        extract(withPolicy.pool),
      ]);
      const createPlan = plan(withoutState.factBase, withState.factBase, {
        policy: supabasePolicy,
      });
      const createSql = createPlan.actions.map((a) => a.sql);
      expect(createSql.some((s) => /CREATE TABLE/i.test(s))).toBe(false);
      expect(createSql.some((s) => /ENABLE ROW LEVEL SECURITY/i.test(s))).toBe(
        false,
      );
      expect(createSql).toMatchInlineSnapshot(`
        [
          "CREATE POLICY "Users can read own objects" ON "storage"."objects" FOR SELECT TO "authenticated" USING ((bucket_id = 'x'::text))",
        ]
      `);

      const created = await apply(createPlan, without.pool, {
        fingerprintGate: false,
      });
      expect(created.status).toBe("applied");
      expect(
        plan((await extract(without.pool)).factBase, withState.factBase, {
          policy: supabasePolicy,
        }).actions,
      ).toEqual([]);

      const empty = await makeDb("pol_obj_empty");
      const dropPlan = plan(
        (await extract(withPolicy.pool)).factBase,
        (await extract(empty.pool)).factBase,
        { policy: supabasePolicy },
      );
      expect(dropPlan.actions.some((a) => /DROP POLICY/i.test(a.sql))).toBe(
        true,
      );
      const dropped = await apply(dropPlan, withPolicy.pool, {
        fingerprintGate: false,
      });
      expect(dropped.status).toBe("applied");
      expect(
        plan(
          (await extract(withPolicy.pool)).factBase,
          (await extract(empty.pool)).factBase,
          { policy: supabasePolicy },
        ).actions,
      ).toEqual([]);
    }, 180_000);

    test("a usingExpr edit rebuilds the policy (DROP + CREATE)", async () => {
      const before = await makeDb("pol_edit_a", OBJECTS_POLICY);
      const after = await makeDb("pol_edit_b", OBJECTS_POLICY);
      await after.pool.query(OBJECTS_POLICY_EDITED);

      const sql = await planSql(before, after);
      expect(sql.some((s) => s.startsWith("DROP POLICY"))).toBe(true);
      expect(sql.some((s) => s.startsWith("CREATE POLICY"))).toBe(true);
      expect(sql.some((s) => /bucket_id = 'y'/.test(s))).toBe(true);
    }, 180_000);

    test("export files the policy under the table without recreating it", async () => {
      const db = await makeDb("pol_export", OBJECTS_POLICY);
      const { factBase } = await extract(db.pool);
      const view = resolveView(factBase, supabasePolicy);
      const files = exportSqlFiles(view, {
        assumedSchemas: flat.assumedSchemas,
        assumedRoles: flat.assumedRoles,
      });
      const allSql = files.map((f) => f.sql).join("\n");
      expect(allSql).not.toMatch(/CREATE TABLE[^;]*"?objects"?/i);
      expect(allSql).not.toMatch(/ENABLE ROW LEVEL SECURITY/i);

      const objectsFile = files.find(
        (f) =>
          f.name === "storage/tables/objects.sql" ||
          f.name === "schemas/storage/tables/objects.sql",
      );
      expect(objectsFile).toBeDefined();
      expect(objectsFile?.sql).toMatch(/CREATE POLICY/);
      expect(objectsFile?.sql).toMatchInlineSnapshot(`
        "CREATE POLICY "Users can read own objects" ON "storage"."objects" FOR SELECT TO "authenticated" USING ((bucket_id = 'x'::text));
        "
      `);
    }, 180_000);

    test("diff/apply/converge a realtime.messages policy", async () => {
      const without = await makeDb("pol_msg_wo");
      const withPolicy = await makeDb("pol_msg_w", MESSAGES_POLICY);
      const sql = await planSql(without, withPolicy);
      expect(sql.some((s) => /CREATE POLICY/.test(s))).toBe(true);
      expect(sql.some((s) => /realtime"\."messages/.test(s))).toBe(true);

      const thePlan = plan(
        (await extract(without.pool)).factBase,
        (await extract(withPolicy.pool)).factBase,
        { policy: supabasePolicy },
      );
      const report = await apply(thePlan, without.pool, {
        fingerprintGate: false,
      });
      expect(report.status).toBe("applied");
      expect(
        plan(
          (await extract(without.pool)).factBase,
          (await extract(withPolicy.pool)).factBase,
          { policy: supabasePolicy },
        ).actions,
      ).toEqual([]);
    }, 180_000);

    test("diff/apply/converge a realtime.subscription policy", async () => {
      const without = await makeDb("pol_sub_wo");
      const withPolicy = await makeDb("pol_sub_w", SUBSCRIPTION_POLICY);
      const sql = await planSql(without, withPolicy);
      expect(sql.some((s) => /CREATE POLICY/.test(s))).toBe(true);
      expect(sql.some((s) => /realtime"\."subscription/.test(s))).toBe(true);

      const thePlan = plan(
        (await extract(without.pool)).factBase,
        (await extract(withPolicy.pool)).factBase,
        { policy: supabasePolicy },
      );
      const report = await apply(thePlan, without.pool, {
        fingerprintGate: false,
      });
      expect(report.status).toBe("applied");
      expect(
        plan(
          (await extract(without.pool)).factBase,
          (await extract(withPolicy.pool)).factBase,
          { policy: supabasePolicy },
        ).actions,
      ).toEqual([]);
    }, 180_000);

    test("diff/apply/converge an auth.users policy (schema-wide carve-out)", async () => {
      const without = await makeDb("pol_auth_wo");
      const withPolicy = await makeDb("pol_auth_w", AUTH_USERS_POLICY);
      const sql = await planSql(without, withPolicy);
      expect(sql.some((s) => /CREATE POLICY "own row only"/.test(s))).toBe(
        true,
      );
      expect(sql.some((s) => /auth"\."users/.test(s))).toBe(true);
      expect(sql.some((s) => /CREATE TABLE/i.test(s))).toBe(false);

      const thePlan = plan(
        (await extract(without.pool)).factBase,
        (await extract(withPolicy.pool)).factBase,
        { policy: supabasePolicy },
      );
      const report = await apply(thePlan, without.pool, {
        fingerprintGate: false,
      });
      expect(report.status).toBe("applied");
      expect(
        plan(
          (await extract(without.pool)).factBase,
          (await extract(withPolicy.pool)).factBase,
          { policy: supabasePolicy },
        ).actions,
      ).toEqual([]);
    }, 180_000);

    test("export files the auth.users policy under the table without recreating it", async () => {
      const db = await makeDb("pol_auth_export", AUTH_USERS_POLICY);
      const { factBase } = await extract(db.pool);
      const view = resolveView(factBase, supabasePolicy);
      const files = exportSqlFiles(view, {
        assumedSchemas: flat.assumedSchemas,
        assumedRoles: flat.assumedRoles,
      });
      const allSql = files.map((f) => f.sql).join("\n");
      expect(allSql).not.toMatch(/CREATE TABLE[^;]*"?users"?/i);
      expect(allSql).not.toMatch(/ENABLE ROW LEVEL SECURITY/i);

      const usersFile = files.find(
        (f) =>
          f.name === "auth/tables/users.sql" ||
          f.name === "schemas/auth/tables/users.sql",
      );
      expect(usersFile).toBeDefined();
      expect(usersFile?.sql).toMatch(/CREATE POLICY "own row only"/);
    }, 180_000);

    test("COMMENT ON POLICY round-trips with the policy (REAL-997)", async () => {
      const without = await makeDb("pol_cmt_wo");
      const withPolicy = await makeDb("pol_cmt_w", OBJECTS_POLICY_WITH_COMMENT);

      const createPlan = plan(
        (await extract(without.pool)).factBase,
        (await extract(withPolicy.pool)).factBase,
        { policy: supabasePolicy },
      );
      const createSql = createPlan.actions.map((a) => a.sql);
      expect(createSql.some((s) => /CREATE POLICY/.test(s))).toBe(true);
      expect(
        createSql.some((s) =>
          /COMMENT ON POLICY "Users can read own objects"/.test(s),
        ),
      ).toBe(true);

      const created = await apply(createPlan, without.pool, {
        fingerprintGate: false,
      });
      expect(created.status).toBe("applied");
      expect(
        plan(
          (await extract(without.pool)).factBase,
          (await extract(withPolicy.pool)).factBase,
          { policy: supabasePolicy },
        ).actions,
      ).toEqual([]);

      // the comment exports next to its policy, still without CREATE TABLE
      const { factBase } = await extract(withPolicy.pool);
      const view = resolveView(factBase, supabasePolicy);
      const files = exportSqlFiles(view, {
        assumedSchemas: flat.assumedSchemas,
        assumedRoles: flat.assumedRoles,
      });
      const allSql = files.map((f) => f.sql).join("\n");
      expect(allSql).not.toMatch(/CREATE TABLE[^;]*"?objects"?/i);
      expect(allSql).toMatch(/COMMENT ON POLICY "Users can read own objects"/);
      expect(allSql).toMatch(/customer note/);

      // dropping only the comment converges too (plans COMMENT … IS NULL)
      await withPolicy.pool.query(
        `COMMENT ON POLICY "Users can read own objects" ON storage.objects IS NULL`,
      );
      const dropCommentPlan = plan(
        (await extract(without.pool)).factBase,
        (await extract(withPolicy.pool)).factBase,
        { policy: supabasePolicy },
      );
      expect(
        dropCommentPlan.actions.some((a) =>
          /COMMENT ON POLICY[\s\S]*IS NULL/.test(a.sql),
        ),
      ).toBe(true);
      const dropped = await apply(dropCommentPlan, without.pool, {
        fingerprintGate: false,
      });
      expect(dropped.status).toBe("applied");
      expect(
        plan(
          (await extract(without.pool)).factBase,
          (await extract(withPolicy.pool)).factBase,
          { policy: supabasePolicy },
        ).actions,
      ).toEqual([]);
    }, 180_000);

    test("a storage.objects policy calling auth.uid() plans and applies", async () => {
      const without = await makeDb("pol_uid_wo");
      const withPolicy = await makeDb("pol_uid_w", AUTH_UID_POLICY);
      const sql = await planSql(without, withPolicy);
      expect(sql.some((s) => /CREATE POLICY "owner can read"/.test(s))).toBe(
        true,
      );

      const thePlan = plan(
        (await extract(without.pool)).factBase,
        (await extract(withPolicy.pool)).factBase,
        { policy: supabasePolicy },
      );
      const report = await apply(thePlan, without.pool, {
        fingerprintGate: false,
      });
      expect(report.status).toBe("applied");
      expect(
        plan(
          (await extract(without.pool)).factBase,
          (await extract(withPolicy.pool)).factBase,
          { policy: supabasePolicy },
        ).actions,
      ).toEqual([]);
    }, 180_000);
  },
);
