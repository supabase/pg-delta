/**
 * probeApplierCapability against a real connection (managed-view move 6).
 * The capability-restricted view's projection logic is unit-tested
 * (src/policy/capability.test.ts); this proves the probe query runs and reports
 * the connection's role / superuser / memberships. Docker required.
 */
import { describe, expect, test } from "bun:test";
import pg from "pg";
import { probeApplierCapability } from "../src/policy/capability.ts";
import { sharedCluster } from "./containers.ts";

describe("probeApplierCapability (integration)", () => {
  test("reports the connection's role, superuser flag, and memberships", async () => {
    const cluster = await sharedCluster();
    const cap = await probeApplierCapability(cluster.adminPool);
    // the container admin is a superuser
    expect(cap.role.length).toBeGreaterThan(0);
    expect(cap.isSuperuser).toBe(true);
    // memberOf is a real parsed string[] (a role is a member of itself) — guards
    // against the pg driver returning the array as an unparsed "{...}" literal.
    expect(Array.isArray(cap.memberOf)).toBe(true);
    expect(cap.memberOf).toContain(cap.role);
  }, 60_000);

  // The capability FDW-ACL gate is keyed on isSuperuser. This pins the rule it
  // rests on (Supabase Rule 9's stated rationale): a non-superuser cannot GRANT
  // on a FOREIGN DATA WRAPPER, so its ACL is not user-replayable.
  test("VERIFY: a non-superuser cannot GRANT on a FOREIGN DATA WRAPPER", async () => {
    const cluster = await sharedCluster();
    const db = await cluster.createDb("cap_fdw_verify");
    try {
      await db.pool.query(`CREATE EXTENSION IF NOT EXISTS postgres_fdw`);
      await cluster.adminPool
        .query(`CREATE ROLE cap_nonsuper LOGIN PASSWORD 'pw'`)
        .catch(() => {});

      const capUri = db.uri.replace("test:test@", "cap_nonsuper:pw@");
      const capPool = new pg.Pool({ connectionString: capUri, max: 1 });
      capPool.on("error", () => {});
      try {
        const cap = await probeApplierCapability(capPool);
        expect(cap.isSuperuser).toBe(false); // a plain LOGIN role is not super

        let grantError: string | undefined;
        try {
          await capPool.query(
            `GRANT USAGE ON FOREIGN DATA WRAPPER postgres_fdw TO PUBLIC`,
          );
        } catch (e) {
          grantError = String(e);
        }
        // the GRANT must be rejected — confirming the isSuperuser gate
        expect(grantError).toBeDefined();
      } finally {
        await capPool.end().catch(() => {});
      }
    } finally {
      await db.drop();
      await cluster.adminPool
        .query(`DROP ROLE IF EXISTS cap_nonsuper`)
        .catch(() => {});
    }
  }, 60_000);
});
