/**
 * DROP EXTENSION is destructive iff the extension owns a data-bearing persisted
 * member (table / materialized view): dropping it cascades to those members and
 * destroys their rows, yet the members are projected out of the diff (kept
 * reference-only) so nothing else raises the destructive flag. The drop rule
 * derives it from the member closure (src/plan/rules/schemas.ts). Docker
 * required (two real extracts prove the whole chain: the extractor emits the
 * `memberOfExtension` edge → resolveView keeps the member reference-only → the
 * drop rule flags data-loss).
 *
 * An extension whose members are only functions/types (citext) stays
 * non-destructive — the companion case that keeps the flag from over-firing.
 */
import { describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { createTestDb } from "./containers.ts";

describe("DROP EXTENSION data-loss (member closure, live extract)", () => {
  test("data-bearing extension member → destructive; functions-only → not", async () => {
    const source = await createTestDb("ext_drop_src");
    const desired = await createTestDb("ext_drop_dst");
    try {
      // hstore owns a user table with rows (added via ALTER EXTENSION … ADD
      // TABLE — the same pg_depend deptype 'e' membership a control file records);
      // citext owns only a type + functions.
      await source.pool.query("CREATE EXTENSION hstore");
      await source.pool.query("CREATE EXTENSION citext");
      await source.pool.query(
        "CREATE TABLE public.ext_data (id integer PRIMARY KEY)",
      );
      await source.pool.query("INSERT INTO public.ext_data VALUES (1), (2)");
      await source.pool.query(
        "ALTER EXTENSION hstore ADD TABLE public.ext_data",
      );

      const sourceFb = (await extract(source.pool)).factBase;
      const desiredFb = (await extract(desired.pool)).factBase;

      // desired has neither extension → the plan drops both.
      const thePlan = plan(sourceFb, desiredFb);

      const hstoreDrop = thePlan.actions.find(
        (a) => a.verb === "drop" && /DROP EXTENSION "hstore"/.test(a.sql),
      );
      const citextDrop = thePlan.actions.find(
        (a) => a.verb === "drop" && /DROP EXTENSION "citext"/.test(a.sql),
      );

      expect(hstoreDrop).toBeDefined();
      expect(citextDrop).toBeDefined();
      // owns a data-bearing member table → destructive
      expect(hstoreDrop!.dataLoss).toBe("destructive");
      expect(hstoreDrop!.destroys).toContainEqual({
        kind: "table",
        schema: "public",
        name: "ext_data",
      });
      // functions/type only → not destructive
      expect(citextDrop!.dataLoss).toBe("none");
      // the aggregate safety report reflects exactly the one destructive drop
      expect(thePlan.safetyReport.destructiveActions).toBe(1);
    } finally {
      await source.drop();
      await desired.drop();
    }
  }, 60_000);
});
