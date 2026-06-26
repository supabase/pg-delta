/**
 * Subscription replication-slot parity (port of the two slot cases in the old
 * subscription-operations.test.ts that the simple corpus scenarios do not
 * cover). Slots are cluster/shared-catalog-adjacent state and DROP-with-slot is
 * transaction-segmentation behavior, so these live as focused apply tests, not
 * bidirectional corpus scenarios (the corpus runner clones via TEMPLATE, which
 * skips subscription state).
 *
 * Two behaviors:
 *  1. Creating a subscription that names an existing slot stays a single
 *     transactional unit and converges. pg-delta-next emits `connect = false`
 *     (apply-friendly: no live publisher needed at apply time) with
 *     `slot_name = '<existing>'`, so no slot is created and the 25001 gate is
 *     never tripped — a deliberate, documented divergence from the old engine's
 *     `connect = true` slot-reuse form.
 *  2. Dropping a subscription that has an associated slot must run OUTSIDE a
 *     transaction block (PostgreSQL 25001): the DROP action self-declares
 *     `nonTransactional`, so the executor isolates it in its own segment.
 */
import { describe, expect, test } from "bun:test";
import { apply } from "../src/apply/apply.ts";
import { diff } from "../src/core/diff.ts";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { sharedCluster } from "./containers.ts";

describe("subscription replication-slot behavior", () => {
  test("create reusing an existing slot stays transactional and converges", async () => {
    const cluster = await sharedCluster();
    const src = await cluster.createDb("sub_slot_create_src");
    const desired = await cluster.createDb("sub_slot_create_dst");
    try {
      const { rows } = await desired.pool.query<{ name: string }>(
        "select current_database() as name",
      );
      const dbName = rows[0]!.name;
      await desired.pool.query(
        "CREATE PUBLICATION sub_reuse_pub FOR ALL TABLES",
      );
      await desired.pool.query(
        "SELECT pg_create_logical_replication_slot('sub_reuse_slot', 'pgoutput')",
      );
      await desired.pool.query(`
        CREATE SUBSCRIPTION sub_reuse
          CONNECTION 'dbname=${dbName}'
          PUBLICATION sub_reuse_pub
          WITH (connect = false, create_slot = false, enabled = false, slot_name = 'sub_reuse_slot');
      `);

      const [s, d] = [await extract(src.pool), await extract(desired.pool)];
      const thePlan = plan(s.factBase, d.factBase);

      const createAction = thePlan.actions.find((a) =>
        a.sql.startsWith(`CREATE SUBSCRIPTION "sub_reuse"`),
      );
      expect(createAction).toBeDefined();
      // names the existing slot, never creates one, and is transaction-safe.
      expect(createAction!.sql).toContain(`slot_name = 'sub_reuse_slot'`);
      expect(createAction!.sql).not.toContain("create_slot = true");
      expect(createAction!.transactionality ?? "transactional").toBe(
        "transactional",
      );

      const report = await apply(thePlan, src.pool, { fingerprintGate: false });
      expect(report.status).toBe("applied");

      // converges: re-extract source and diff against desired.
      const after = await extract(src.pool);
      expect(diff(after.factBase, d.factBase)).toEqual([]);
    } finally {
      await Promise.all([src.drop(), desired.drop()]);
    }
  }, 60_000);

  test("drop with an associated slot is non-transactional and converges", async () => {
    const cluster = await sharedCluster();
    const src = await cluster.createDb("sub_slot_drop_src");
    const desired = await cluster.createDb("sub_slot_drop_dst");
    try {
      const { rows } = await src.pool.query<{ name: string; user: string }>(
        "select current_database() as name, current_user as user",
      );
      const dbName = rows[0]!.name;
      const dbUser = rows[0]!.user;
      // Real, reachable conninfo (same cluster, real role) + a real slot:
      // DROP SUBSCRIPTION uses the catalog's stored conninfo to connect to the
      // publisher and drop the slot, so the user must resolve to a live role.
      await src.pool.query("CREATE PUBLICATION sub_drop_pub FOR ALL TABLES");
      await src.pool.query(
        "SELECT pg_create_logical_replication_slot('sub_drop_slot', 'pgoutput')",
      );
      await src.pool.query(`
        CREATE SUBSCRIPTION sub_drop_with_slot
          CONNECTION 'dbname=${dbName} user=${dbUser}'
          PUBLICATION sub_drop_pub
          WITH (connect = false, create_slot = false, enabled = false, slot_name = 'sub_drop_slot');
      `);
      // an extra object guarantees a multi-statement plan, so a naive
      // single-transaction apply would trip 25001 on the DROP.
      await src.pool.query("CREATE TABLE public.drop_me (id integer)");

      const [s, d] = [await extract(src.pool), await extract(desired.pool)];
      const thePlan = plan(s.factBase, d.factBase);

      const dropAction = thePlan.actions.find((a) =>
        a.sql.startsWith(`DROP SUBSCRIPTION "sub_drop_with_slot"`),
      );
      expect(dropAction).toBeDefined();
      expect(dropAction!.transactionality).toBe("nonTransactional");

      const report = await apply(thePlan, src.pool, { fingerprintGate: false });
      expect(report.status).toBe("applied");

      // the subscription and its slot are gone; state converges to desired.
      const after = await extract(src.pool);
      expect(diff(after.factBase, d.factBase)).toEqual([]);
      const { rows: slots } = await src.pool.query(
        "select 1 from pg_replication_slots where slot_name = 'sub_drop_slot'",
      );
      expect(slots).toHaveLength(0);
    } finally {
      await Promise.all([src.drop(), desired.drop()]);
    }
  }, 60_000);
});
