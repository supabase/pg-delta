/**
 * Unit C (#…): the co-located shadow seed (`deriveAssumedSchemaSeed`) must
 * REPLAY cleanly as a real Supabase-Cloud `postgres` — a privileged NON-
 * superuser (member of `supabase_privileged_role`), not a genuine superuser.
 *
 * An empirical inventory of the real derived seed (460 statements from a
 * base-init'd supabase/postgres 17 image, replayed statement-by-statement as a
 * faithful non-superuser privileged role) closed the failure list at exactly two
 * classes, both SQLSTATE 42501:
 *   1. a SUSET (superuser-context) GUC in a routine's `SET` clause
 *      (`SET log_min_messages TO 'fatal'`) — Postgres validates proconfig at
 *      CREATE time against the creating role, so the routine cannot be created
 *      by a non-superuser AT ALL;
 *   2. `ALTER DEFAULT PRIVILEGES FOR ROLE <foreign>` — executing ADP for another
 *      role requires membership in it, which the privileged role lacks.
 *
 * Both are inert to OMIT: a seeded object re-extracts reference-only and cancels
 * in the diff, so its absence is symmetric, and a platform ADP entry has no
 * possible dependents. The seed therefore SKIPS the whole fact — it never edits
 * SQL text. The SUSET-carrying routine is detected via structured catalog data
 * (`pg_proc.proconfig`, carried as the non-semantic `_configGucs` payload key),
 * never by parsing its `def`. These integration cases replay the derived seed as
 * a purpose-built NON-superuser role on the plain alpine cluster (alpine's
 * default `test` role IS a superuser, so the target setup and extraction run as
 * usual; only the REPLAY drops to the non-superuser role).
 */
import { afterAll, describe, expect, test } from "bun:test";
import pg from "pg";
import { deriveAssumedSchemaSeed } from "../src/frontends/seed-assumed-schemas.ts";
import type { Fact } from "../src/core/fact.ts";
import { extract } from "../src/extract/extract.ts";
import type { Policy } from "../src/policy/policy.ts";
import { type Cluster, sharedCluster, type TestDb } from "./containers.ts";

const dbs: TestDb[] = [];
afterAll(async () => {
  await Promise.all(dbs.map((d) => d.drop().catch(() => {})));
});

// A custom profile that treats `platform` as an assumed (system) schema: every
// fact in `platform` is filtered out of the managed view but kept reference-only
// so a co-located shadow can be seeded with it.
const platformProfile: Policy = {
  id: "test-platform",
  filter: [
    {
      match: { any: [{ schema: "platform" }, { name: "platform" }] },
      action: "exclude",
    },
  ],
  assumedSchemas: ["platform"],
};

async function susetGucsOf(pool: pg.Pool): Promise<Set<string>> {
  const res = await pool.query<{ name: string }>(
    `SELECT name FROM pg_settings WHERE context = 'superuser'`,
  );
  return new Set(res.rows.map((r) => r.name));
}

/** Provision a fresh empty database owned by `role` and replay `seedSql` on it
 *  in ONE batch as `role` (mirroring schema.ts:831). Rejects on the first
 *  statement `role` is not privileged to run. */
async function replaySeedAs(
  cluster: Cluster,
  role: string,
  password: string,
  seedSql: string,
): Promise<void> {
  const fresh = await cluster.createDb("seed_replay");
  dbs.push(fresh);
  // Let the non-superuser role create schemas / objects in this throwaway db.
  await cluster.adminPool.query(
    `GRANT ALL ON DATABASE "${fresh.name}" TO "${role}"`,
  );
  const uri = fresh.uri.replace(
    "postgres://test:test@",
    `postgres://${role}:${password}@`,
  );
  const rpool = new pg.Pool({ connectionString: uri, max: 2 });
  rpool.on("error", () => {});
  try {
    await rpool.query(seedSql);
  } finally {
    await rpool.end().catch(() => {});
  }
}

let replayerSeq = 0;
async function makeReplayer(cluster: Cluster): Promise<[string, string]> {
  const role = `seed_replayer_${Date.now()}_${replayerSeq++}`;
  const password = "replpwd";
  // Faithful to real cloud: a privileged, non-superuser login role.
  await cluster.adminPool.query(
    `CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER CREATEDB`,
  );
  return [role, password];
}

const assumedRolesOf = (facts: Fact[]): string[] =>
  facts
    .filter((f) => f.id.kind === "role")
    .map((f) => (f.id as { name: string }).name);

describe("phase 2b: non-superuser seed replay", () => {
  test("class 1: omits a routine carrying a SUSET-GUC SET clause, keeps a search_path-only routine", async () => {
    const cluster = await sharedCluster();
    const target = await cluster.createDb("seed_suset_tgt");
    dbs.push(target);
    await target.pool.query(
      `CREATE SCHEMA platform;
       CREATE FUNCTION platform.noisy() RETURNS int LANGUAGE sql
         SET log_min_messages TO 'fatal' AS 'SELECT 1';
       CREATE FUNCTION platform.tidy() RETURNS int LANGUAGE sql
         SET search_path TO 'public' AS 'SELECT 1';`,
    );

    const { factBase } = await extract(target.pool);
    const seed = deriveAssumedSchemaSeed(factBase, {
      policy: platformProfile,
      assumedSchemas: ["platform"],
      assumedRoles: assumedRolesOf(factBase.facts()),
      susetGucs: await susetGucsOf(target.pool),
    });

    // GREEN: replays cleanly as a non-superuser role. RED (routine seeded):
    // rejects at CREATE with 42501 `permission denied to set parameter
    // "log_min_messages"`.
    const [role, password] = await makeReplayer(cluster);
    await replaySeedAs(cluster, role, password, seed.sql);

    // the whole SUSET-carrying routine is skipped (not a stripped copy); the
    // search_path-only routine is seeded intact.
    expect(seed.sql).not.toContain("noisy");
    expect(seed.sql).not.toContain("log_min_messages");
    expect(seed.sql).toContain("tidy");
    expect(seed.sql).toContain("search_path");
  }, 120_000);

  test("class 2: omits ALTER DEFAULT PRIVILEGES for a foreign role", async () => {
    const cluster = await sharedCluster();
    const target = await cluster.createDb("seed_adp_tgt");
    dbs.push(target);
    // ADP FOR ROLE test (the cluster superuser): the replayer is NOT a member of
    // it, so replaying this statement would fail 42501.
    await target.pool.query(
      `CREATE SCHEMA platform;
       ALTER DEFAULT PRIVILEGES FOR ROLE test IN SCHEMA platform
         GRANT SELECT ON TABLES TO public;`,
    );

    const { factBase } = await extract(target.pool);
    const seed = deriveAssumedSchemaSeed(factBase, {
      policy: platformProfile,
      assumedSchemas: ["platform"],
      assumedRoles: assumedRolesOf(factBase.facts()),
      susetGucs: await susetGucsOf(target.pool),
    });

    // GREEN: replays cleanly. RED (ADP present): 42501 `permission denied to
    // change default privileges`.
    const [role, password] = await makeReplayer(cluster);
    await replaySeedAs(cluster, role, password, seed.sql);

    // no ADP statement in the seed at all; the assumed schema is still seeded.
    expect(seed.sql).not.toContain("ALTER DEFAULT PRIVILEGES");
    expect(seed.sql).toContain('CREATE SCHEMA "platform"');
  }, 120_000);
});
