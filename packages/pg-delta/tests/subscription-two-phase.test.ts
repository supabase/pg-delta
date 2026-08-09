/**
 * Changing ONLY a subscription's `two_phase` must not drop and recreate it.
 *
 * The old rule classified `two_phase` as a "replace" attribute, so a two_phase
 * flip emitted `DROP SUBSCRIPTION` + `CREATE SUBSCRIPTION`. DROP SUBSCRIPTION
 * drops the publisher's replication slot (it connects via the catalog's stored
 * conninfo), and the recreate uses `connect = false, slot_name = <name>`, which
 * does NOT recreate that remote slot — so the catalog converges while
 * replication is silently broken. On PG17+ `ALTER SUBSCRIPTION … SET
 * (two_phase)` exists (on a disabled subscription), so the change must go
 * through DISABLE → SET → ENABLE and leave the slot intact.
 */
import { describe, expect, test } from "bun:test";
import { apply } from "../src/apply/apply.ts";
import { diff } from "../src/core/diff.ts";
import { buildFactBase } from "../src/core/fact.ts";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { sharedCluster } from "./containers.ts";

describe("subscription two_phase change", () => {
  test("flipping only two_phase alters in place and keeps the replication slot", async () => {
    const cluster = await sharedCluster();
    if ((await cluster.pgMajor()) < 18) return; // ALTER SET (two_phase) is PG18+
    const src = await cluster.createDb("sub_2pc_src");
    try {
      const { rows } = await src.pool.query<{ name: string; user: string }>(
        "select current_database() as name, current_user as user",
      );
      const dbName = rows[0]!.name;
      const dbUser = rows[0]!.user;
      await src.pool.query("CREATE PUBLICATION sub_2pc_pub FOR ALL TABLES");
      await src.pool.query(
        "SELECT pg_create_logical_replication_slot('sub_2pc_slot', 'pgoutput')",
      );
      // created disabled + two_phase=false, naming the existing slot.
      await src.pool.query(`
          CREATE SUBSCRIPTION sub_2pc
            CONNECTION 'dbname=${dbName} user=${dbUser}'
            PUBLICATION sub_2pc_pub
            WITH (connect = false, create_slot = false, enabled = false,
                  slot_name = 'sub_2pc_slot', two_phase = false);
        `);

      const current = await extract(src.pool);
      // desired = current with the subscription's two_phase flipped to true.
      const desiredFacts = current.factBase
        .facts()
        .map((f) =>
          f.id.kind === "subscription"
            ? { ...f, payload: { ...f.payload, twoPhase: true } }
            : f,
        );
      const desired = buildFactBase(
        desiredFacts,
        [...current.factBase.edges],
        current.factBase.source,
      );

      const thePlan = plan(current.factBase, desired);
      const sql = thePlan.actions.map((a) => a.sql);

      // must NOT drop/recreate the subscription (that drops the slot)…
      expect(sql.some((s) => s.startsWith("DROP SUBSCRIPTION"))).toBe(false);
      expect(sql.some((s) => s.startsWith("CREATE SUBSCRIPTION"))).toBe(false);
      // …and must use the in-place SET (two_phase) form on PG18+.
      expect(sql.some((s) => s.includes(`SET (two_phase = true)`))).toBe(true);

      const report = await apply(thePlan, src.pool, {
        fingerprintGate: false,
      });
      expect(report.status).toBe("applied");

      // catalog converges …
      const after = await extract(src.pool);
      expect(diff(after.factBase, desired)).toEqual([]);
      // … AND the replication slot survives.
      const { rows: slots } = await src.pool.query(
        "select 1 from pg_replication_slots where slot_name = 'sub_2pc_slot'",
      );
      expect(slots).toHaveLength(1);
    } finally {
      await src.drop();
    }
  }, 60_000);
});
