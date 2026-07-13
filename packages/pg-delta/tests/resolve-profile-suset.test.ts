/**
 * PR #329 review 3572370377: the SUSET-GUC (superuser-context `pg_settings`)
 * probe used to be hand-rolled inside `schema apply` (CLI), leaking
 * Supabase-shaped concerns into the generic command. It belongs in
 * `resolveProfile` as generic profile-runtime context, gated on the applier
 * actually being a NON-superuser (a superuser applier needs no stripping —
 * see `src/frontends/seed-assumed-schemas.ts`'s `susetGucs` option and
 * `tests/phase2b-seed-nonsuperuser.test.ts` for why the probe exists at all).
 *
 * These cases use a minimal custom `IntegrationProfile` (no Supabase image
 * required) so the probe's gating logic is exercised in isolation:
 *   1. policy declares `assumedSchemas` + a NON-superuser connection →
 *      `resolved.susetGucs` is defined and contains `log_min_messages`.
 *   2. same policy + a SUPERUSER connection → `susetGucs` is undefined.
 *   3. policy WITHOUT `assumedSchemas` (non-superuser connection) →
 *      `susetGucs` is undefined (the probe isn't even relevant).
 */
import { afterAll, describe, expect, test } from "bun:test";
import pg from "pg";
import { resolveProfile } from "../src/integrations/profile.ts";
import type { IntegrationProfile } from "../src/integrations/profile.ts";
import { createTestDb, type TestDb } from "./containers.ts";

const dbs: TestDb[] = [];
const extraPools: pg.Pool[] = [];
afterAll(async () => {
  await Promise.all(extraPools.map((p) => p.end().catch(() => {})));
  await Promise.all(dbs.map((d) => d.drop().catch(() => {})));
});

const profileWithAssumedSchemas: IntegrationProfile = {
  id: "test-assumed-schemas",
  handlers: [],
  policy: {
    id: "test-assumed-schemas-policy",
    assumedSchemas: ["platform"],
  },
};

const profileWithoutAssumedSchemas: IntegrationProfile = {
  id: "test-no-assumed-schemas",
  handlers: [],
  policy: {
    id: "test-no-assumed-schemas-policy",
  },
};

let replayerSeq = 0;
/** Provision a non-superuser LOGIN role and a Pool connected as it against
 *  `db` (mirrors tests/phase2b-seed-nonsuperuser.test.ts's `makeReplayer`). */
async function nonSuperuserPool(db: TestDb): Promise<pg.Pool> {
  const role = `suset_probe_${Date.now()}_${replayerSeq++}`;
  const password = "probepwd";
  await db.cluster.adminPool.query(
    `CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER`,
  );
  await db.cluster.adminPool.query(
    `GRANT ALL ON DATABASE "${db.name}" TO "${role}"`,
  );
  const uri = db.uri.replace(
    "postgres://test:test@",
    `postgres://${role}:${password}@`,
  );
  const pool = new pg.Pool({ connectionString: uri, max: 2 });
  pool.on("error", () => {});
  extraPools.push(pool);
  return pool;
}

describe("resolveProfile: SUSET-GUC probe", () => {
  test("assumedSchemas + non-superuser connection -> susetGucs is defined", async () => {
    const db = await createTestDb("suset_nonsuper");
    dbs.push(db);
    const pool = await nonSuperuserPool(db);

    const resolved = await resolveProfile(pool, profileWithAssumedSchemas);

    expect(resolved.susetGucs).toBeDefined();
    expect(resolved.susetGucs?.has("log_min_messages")).toBe(true);
  }, 60_000);

  test("assumedSchemas + superuser connection -> susetGucs is undefined", async () => {
    const db = await createTestDb("suset_super");
    dbs.push(db);

    // db.pool connects as the stock alpine cluster's `test` role, which IS a
    // superuser (tests/phase2b-seed-nonsuperuser.test.ts's setup comment).
    const resolved = await resolveProfile(db.pool, profileWithAssumedSchemas);

    expect(resolved.susetGucs).toBeUndefined();
  }, 60_000);

  test("no assumedSchemas + non-superuser connection -> susetGucs is undefined", async () => {
    const db = await createTestDb("suset_noassumed");
    dbs.push(db);
    const pool = await nonSuperuserPool(db);

    const resolved = await resolveProfile(pool, profileWithoutAssumedSchemas);

    expect(resolved.susetGucs).toBeUndefined();
  }, 60_000);
});
