/**
 * When a composite type's ATTRIBUTE stops using a user type that the SAME plan
 * drops, the `ALTER TYPE … ALTER ATTRIBUTE … TYPE …` that releases the user
 * type must be ordered BEFORE the `DROP TYPE` of that user type. The
 * attribute→type dependency is extracted onto the enclosing composite `type`
 * fact, but the alter action is keyed to the `typeAttribute` child fact, so
 * without an explicit release the graph can emit `DROP TYPE` first and
 * PostgreSQL rejects it ("cannot drop type … because other objects depend on
 * it").
 */
import { describe, expect, test } from "bun:test";
import { apply } from "../src/apply/apply.ts";
import { diff } from "../src/core/diff.ts";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { sharedCluster } from "./containers.ts";

describe("composite attribute drops its user type in one plan", () => {
  test("the attribute type change is ordered before DROP TYPE and converges", async () => {
    const cluster = await sharedCluster();
    const src = await cluster.createDb("comp_attr_src");
    const dst = await cluster.createDb("comp_attr_dst");
    try {
      // src: a standalone composite whose attribute uses a user enum.
      await src.pool.query("CREATE TYPE public.usr AS ENUM ('a', 'b')");
      await src.pool.query(
        "CREATE TYPE public.comp AS (f public.usr, g integer)",
      );
      // dst: the attribute is plain text and the enum is gone.
      await dst.pool.query("CREATE TYPE public.comp AS (f text, g integer)");

      const [s, d] = [await extract(src.pool), await extract(dst.pool)];
      const thePlan = plan(s.factBase, d.factBase);
      const sql = thePlan.actions.map((a) => a.sql);

      // both statements are present …
      const alterIdx = sql.findIndex(
        (t) => t.includes("ALTER ATTRIBUTE") && t.includes('"comp"'),
      );
      const dropIdx = sql.findIndex((t) =>
        t.startsWith('DROP TYPE "public"."usr"'),
      );
      expect(alterIdx).toBeGreaterThanOrEqual(0);
      expect(dropIdx).toBeGreaterThanOrEqual(0);
      // … and the attribute releases the enum before it is dropped.
      expect(alterIdx).toBeLessThan(dropIdx);

      const report = await apply(thePlan, src.pool, {
        fingerprintGate: false,
      });
      expect(report.status).toBe("applied");

      const after = await extract(src.pool);
      expect(diff(after.factBase, d.factBase)).toEqual([]);
    } finally {
      await Promise.all([src.drop(), dst.drop()]);
    }
  }, 60_000);
});
