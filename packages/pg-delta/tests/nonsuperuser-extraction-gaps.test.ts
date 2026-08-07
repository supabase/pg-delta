/**
 * Non-superuser / library-caller correctness (issue #333, items 13-14).
 *
 * Existing non-superuser harnesses never actually call `extract()` with a
 * non-superuser CONNECTION: `capability.test.ts` only probes
 * `probeApplierCapability`, and `phase2b-seed-nonsuperuser.test.ts` extracts as
 * the (superuser) cluster admin and only REPLAYS the derived seed SQL as a
 * non-superuser role. So a query inside the extractor that requires
 * superuser-only catalog access was never exercised end-to-end.
 *
 * Item 14's bug is reachable with ZERO extra grants beyond CONNECT on the
 * database as soon as any subscription exists — PostgreSQL's column
 * permission check on `pg_subscription.subconninfo` is a static, parse-time
 * check keyed on which columns the query TEXT references, not on whether any
 * row would actually match. Item 13's role query is additionally guarded by a
 * `pg_seclabel`/`pg_shseclabel` existence probe (the common no-labels case
 * skips the resolver entirely), so it only reaches the buggy `pg_authid` join
 * once an actual ROLE security label exists somewhere in the cluster — hence
 * the heavier `seclabelCluster()` (dummy label provider) fixture below.
 */
import { afterAll, describe, expect, test } from "bun:test";
import pg from "pg";
import { extractSecurityLabels } from "../src/extract/security-labels.ts";
import { extractSubscriptions } from "../src/extract/publications.ts";
import { createExtractContext } from "../src/extract/scope.ts";
import { SUBSCRIPTION_CONNINFO_PLACEHOLDER } from "../src/extract/sensitive-options.ts";
import {
  seclabelCluster,
  sharedCluster,
  skipSeclabelProof,
  type TestDb,
} from "./containers.ts";

const dbs: TestDb[] = [];
afterAll(async () => {
  await Promise.all(dbs.map((d) => d.drop().catch(() => {})));
});

let roleSeq = 0;
/** A bare LOGIN role with NO grants beyond CONNECT on `db` — the minimum a
 *  library caller can realistically hand pg-delta. */
async function plainNonSuperuser(
  db: TestDb,
): Promise<{ role: string; pool: pg.Pool }> {
  const role = `plain_role_${Date.now()}_${roleSeq++}`;
  await db.cluster.adminPool.query(`CREATE ROLE "${role}" LOGIN PASSWORD 'pw'`);
  await db.cluster.adminPool.query(
    `GRANT CONNECT ON DATABASE "${db.name}" TO "${role}"`,
  );
  const uri = db.uri.replace("postgres://test:test@", `postgres://${role}:pw@`);
  const pool = new pg.Pool({ connectionString: uri, max: 2 });
  pool.on("error", () => {});
  return { role, pool };
}

describe.skipIf(skipSeclabelProof)(
  "item 13: role security-label extraction as a plain non-superuser",
  () => {
    test("does not throw permission denied for pg_authid", async () => {
      const cluster = await seclabelCluster();
      const db = await cluster.createDb("seclabel_nonsuper");
      dbs.push(db);
      const labeledRole = `sl13_labeled_role_${Date.now()}`;
      await cluster.adminPool.query(`CREATE ROLE "${labeledRole}"`);
      // a ROLE security label is a SHARED-catalog row (pg_shseclabel), visible
      // from every database in the cluster — this is what makes item 13's
      // `hasSeclabels` probe (security-labels.ts) return true and reach the
      // buggy pg_authid join.
      await cluster.adminPool.query(
        `SECURITY LABEL FOR 'dummy' ON ROLE "${labeledRole}" IS 'classified';`,
      );
      const { role, pool } = await plainNonSuperuser(db);
      try {
        const client = await pool.connect();
        try {
          const ctx = await createExtractContext(client, undefined, true);
          // GREEN: resolves. RED (pg_authid join): rejects with
          // `permission denied for table pg_authid`.
          await extractSecurityLabels(ctx);
          // extractSecurityLabels alone never emits a `role` fact (roles come
          // from extractRoles) — it emits a `securityLabel` satellite fact
          // parented to the role's stable id, which is the resolver's actual
          // output for this row.
          const labeled = ctx.facts.find(
            (f) =>
              f.id.kind === "securityLabel" &&
              (f.id as { target: { kind: string; name: string } }).target
                .kind === "role" &&
              (f.id as { target: { kind: string; name: string } }).target
                .name === labeledRole,
          );
          expect(labeled).toBeDefined();
        } finally {
          client.release();
        }
      } finally {
        await pool.end().catch(() => {});
        await cluster.adminPool
          .query(`DROP ROLE IF EXISTS "${role}"`)
          .catch(() => {});
        await cluster.adminPool
          .query(`DROP ROLE IF EXISTS "${labeledRole}"`)
          .catch(() => {});
      }
    }, 120_000);
  },
);

describe("item 14: subscription extraction as a plain non-superuser", () => {
  test("does not throw permission denied for pg_subscription.subconninfo, and redacts the placeholder", async () => {
    const cluster = await sharedCluster();
    const target = await cluster.createDb("sub_nonsuper_tgt");
    dbs.push(target);
    const { rows } = await target.pool.query<{ name: string }>(
      "select current_database() as name",
    );
    const dbName = rows[0]!.name;
    await target.pool.query(`
      CREATE PUBLICATION nonsuper_pub FOR ALL TABLES;
      CREATE SUBSCRIPTION nonsuper_sub
        CONNECTION 'dbname=${dbName} password=nonsuper-secret'
        PUBLICATION nonsuper_pub
        WITH (connect = false, create_slot = false, enabled = false, slot_name = NONE);
    `);

    const { role, pool } = await plainNonSuperuser(target);
    try {
      const client = await pool.connect();
      try {
        const ctx = await createExtractContext(client, undefined, true);
        // GREEN: resolves and the fact carries the placeholder (the real
        // conninfo is unreadable to this role either way). RED (unconditional
        // s.subconninfo select): rejects with `permission denied for table
        // pg_subscription`.
        await extractSubscriptions(ctx);
        const sub = ctx.facts.find((f) => f.id.kind === "subscription");
        expect(sub).toBeDefined();
        expect((sub!.payload as { conninfo: string }).conninfo).toBe(
          SUBSCRIPTION_CONNINFO_PLACEHOLDER,
        );
      } finally {
        client.release();
      }
    } finally {
      await pool.end().catch(() => {});
      await cluster.adminPool
        .query(`DROP ROLE IF EXISTS "${role}"`)
        .catch(() => {});
    }
  }, 60_000);
});
