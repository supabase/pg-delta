/**
 * User GRANTs to customer-created roles on managed-schema objects (CLI-1385
 * Phase 5, Unit B) must survive the supabase managed-schema filter, export as
 * TABLE_SCOPED satellites of a reference-only parent (no CREATE TABLE), and
 * round-trip through plan → apply → re-diff — with apply running as the real
 * non-superuser `postgres`, whose replay right is the platform's
 * `SELECT ... WITH GRANT OPTION` (auth's 20240612123726 migration), mirrored
 * here on the stand-in tables. Grants TO platform grantees (API roles,
 * postgres, PUBLIC) stay excluded: they collide with platform-seeded entries
 * at the (target, grantee) fact grain.
 *
 * Stand-in tables exercise the policy the same way the managed-policies file
 * does; the pristine guard boots the standalone bare image and replays
 * `applySupabaseBaseInit` to pin that the platform seeds no managed-schema
 * grants to non-platform grantees.
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
  SUPABASE_SYSTEM_ROLES,
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
const postgresPools: pg.Pool[] = [];
afterAll(async () => {
  await Promise.all([
    ...postgresPools.map((p) => p.end().catch(() => {})),
    ...dbs.map((d) => d.drop().catch(() => {})),
  ]);
});

/** Non-superuser `postgres` pool — the real `--target` role on Cloud. Stand-in
 *  tables stay admin-owned so a replayed GRANT exercises the platform's
 *  WITH GRANT OPTION right rather than ownership. */
function asPostgres(db: TestDb): pg.Pool {
  if (db.postgresUri === undefined) {
    throw new Error("supabase cluster TestDb is missing postgresUri");
  }
  const pool = new pg.Pool({ connectionString: db.postgresUri, max: 3 });
  pool.on("error", () => {});
  postgresPools.push(pool);
  return pool;
}

/** Grantees the platform itself uses on managed-schema objects (mirrors the
 *  rule's exclusion list): system roles, postgres, PUBLIC, pg_* built-ins. */
const PLATFORM_GRANTEES = new Set<string>([
  ...SUPABASE_SYSTEM_ROLES,
  "postgres",
  "PUBLIC",
]);
const isPlatformGrantee = (grantee: string): boolean =>
  PLATFORM_GRANTEES.has(grantee) || grantee.startsWith("pg_");

// Roles are cluster-global on the shared singleton: file-scoped unique names,
// created idempotently on both sides of each diff so only the GRANT differs.
const READER_ROLE = "ubg_app_reader";

const STANDIN_SURFACES = `
  CREATE SCHEMA IF NOT EXISTS storage;
  CREATE TABLE IF NOT EXISTS storage.objects (
    id uuid PRIMARY KEY,
    bucket_id text,
    name text
  );
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE TABLE IF NOT EXISTS auth.users (
    id uuid PRIMARY KEY,
    email text
  );
  DO $$ BEGIN
    CREATE ROLE ${READER_ROLE};
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;
  -- the platform's replay right: auth's 20240612123726 migration gives
  -- postgres SELECT ... WITH GRANT OPTION on its tables
  GRANT SELECT ON auth.users TO postgres WITH GRANT OPTION;
  GRANT SELECT ON storage.objects TO postgres WITH GRANT OPTION;
`;

// Customer grants are executed AS `postgres` (dashboard / CLI both connect as
// it), which matters for the reverse direction: PostgreSQL's REVOKE removes
// only aclitems whose grantor is the revoking role, so a non-owner `postgres`
// can undo exactly the grants it made — the platform reality this file
// replays. Tests run this through asPostgres(db), never db.pool.
const READER_GRANT = `
  GRANT SELECT ON auth.users TO ${READER_ROLE};
`;

const PLATFORM_SHAPED_GRANT = `
  GRANT SELECT ON storage.objects TO authenticated;
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

function isManagedSchemaTarget(id: StableId): boolean {
  if (id.kind !== "acl") return false;
  const target = id.target as { schema?: string; kind: string; name?: string };
  return (
    target.schema === "auth" ||
    target.schema === "storage" ||
    target.schema === "realtime" ||
    (target.kind === "schema" &&
      (target.name === "auth" ||
        target.name === "storage" ||
        target.name === "realtime"))
  );
}

describe.skipIf(!runSupabaseBareTests)(
  "supabase profile: user GRANTs on managed-schema surfaces",
  () => {
    test("pristine image seeds no managed-schema grants to customer grantees", async () => {
      const stack = await startStandaloneSupabase();
      const pool = new pg.Pool({
        connectionString: stack.connectionUri("postgres"),
        max: 3,
      });
      try {
        await applySupabaseBaseInit(pool);
        const { factBase } = await extract(pool);
        const customerGrants = factBase
          .facts()
          .filter(
            (fct) =>
              fct.id.kind === "acl" &&
              isManagedSchemaTarget(fct.id) &&
              !isPlatformGrantee(fct.id.grantee),
          )
          .map((fct) => fct.id);
        expect(customerGrants).toEqual([]);
      } finally {
        await pool.end();
        await stack.stop();
      }
    }, 180_000);

    test("diff/apply/converge a customer-role grant on auth.users as postgres", async () => {
      const without = await makeDb("grant_wo");
      const withGrant = await makeDb("grant_w");
      await asPostgres(withGrant).query(READER_GRANT);
      const postgres = asPostgres(without);

      const createPlan = plan(
        (await extract(without.pool)).factBase,
        (await extract(withGrant.pool)).factBase,
        { policy: supabasePolicy },
      );
      const createSql = createPlan.actions.map((a) => a.sql);
      expect(createSql.some((s) => /CREATE TABLE/i.test(s))).toBe(false);
      expect(createSql.some((s) => /CREATE ROLE/i.test(s))).toBe(false);
      expect(
        createSql.some((s) =>
          new RegExp(
            `GRANT SELECT ON [^;]*users[^;]* TO "${READER_ROLE}"`,
          ).test(s),
        ),
      ).toBe(true);

      const created = await apply(createPlan, postgres, {
        fingerprintGate: false,
      });
      expect(created.status).toBe("applied");
      expect(
        plan(
          (await extract(without.pool)).factBase,
          (await extract(withGrant.pool)).factBase,
          { policy: supabasePolicy },
        ).actions,
      ).toEqual([]);

      // the reverse direction revokes, applied by the same non-owner postgres
      const empty = await makeDb("grant_empty");
      const revokePlan = plan(
        (await extract(withGrant.pool)).factBase,
        (await extract(empty.pool)).factBase,
        { policy: supabasePolicy },
      );
      expect(
        revokePlan.actions.some((a) =>
          new RegExp(`REVOKE [^;]* FROM "${READER_ROLE}"`).test(a.sql),
        ),
      ).toBe(true);
      const revoked = await apply(revokePlan, asPostgres(withGrant), {
        fingerprintGate: false,
      });
      expect(revoked.status).toBe("applied");
      expect(
        plan(
          (await extract(withGrant.pool)).factBase,
          (await extract(empty.pool)).factBase,
          { policy: supabasePolicy },
        ).actions,
      ).toEqual([]);
    }, 180_000);

    test("export files the grant under the table without recreating it", async () => {
      const db = await makeDb("grant_export");
      await asPostgres(db).query(READER_GRANT);
      const { factBase } = await extract(db.pool);
      const view = resolveView(factBase, supabasePolicy);
      const files = exportSqlFiles(view, {
        assumedSchemas: flat.assumedSchemas,
        assumedRoles: flat.assumedRoles,
      });
      const allSql = files.map((f) => f.sql).join("\n");
      expect(allSql).not.toMatch(/CREATE TABLE[^;]{0,200}"?users"?/i);

      const usersFile = files.find(
        (f) =>
          f.name === "auth/tables/users.sql" ||
          f.name === "schemas/auth/tables/users.sql",
      );
      expect(usersFile).toBeDefined();
      expect(usersFile?.sql).toMatch(
        new RegExp(`GRANT SELECT ON [^;]*users[^;]* TO "${READER_ROLE}"`),
      );
    }, 180_000);

    test("a platform-shaped grant (TO authenticated) stays unmanaged", async () => {
      // Present on one side only, it must still produce NO plan: grants to
      // API roles on managed tables collide with platform-seeded entries at
      // the (target, grantee) grain and stay platform-managed.
      const without = await makeDb("grant_plat_wo");
      const withGrant = await makeDb("grant_plat_w", PLATFORM_SHAPED_GRANT);
      const actions = plan(
        (await extract(without.pool)).factBase,
        (await extract(withGrant.pool)).factBase,
        { policy: supabasePolicy },
      ).actions;
      expect(actions).toEqual([]);
    }, 180_000);
  },
);
