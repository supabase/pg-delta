/**
 * A sequence bound/START change whose old and new ranges OVERLAP must NOT
 * `RESTART` the live counter. The counter (`last_value`) is unmodeled runtime
 * state; resetting it to START would replay already-issued values → duplicate
 * keys. Only a DISJOINT range shift may realign the counter (see
 * plan/rules/helpers.ts::rangesDisjoint).
 *
 * RED (before the disjoint refinement): the plan appended `RESTART` whenever a
 * bound AND START both moved, so a sequence advanced to 500 was reset to the new
 * START (2) on apply — the assertion below saw last_value = 2. GREEN: overlapping
 * ranges leave the counter at 500.
 *
 * Stock alpine image; Docker required.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { provePlan } from "../src/proof/prove.ts";
import { createTestDb, type TestDb } from "./containers.ts";

let source: TestDb;
let desired: TestDb;
let clone: TestDb;

beforeAll(async () => {
  source = await createTestDb("seq-restart-live-src");
  desired = await createTestDb("seq-restart-live-dst");
  // source: a sequence whose live counter has been advanced to 500.
  await source.pool.query(`
    CREATE SEQUENCE public.s MINVALUE 1;
    SELECT setval('public.s', 500);
  `);
  // desired: an OVERLAPPING range change — MIN 1→0 and START 1→2 with the max
  // bound unchanged. [1, MAX] and [0, MAX] overlap, so 500 is still valid.
  await desired.pool.query(`CREATE SEQUENCE public.s MINVALUE 0 START WITH 2;`);
}, 120_000);

afterAll(async () => {
  await Promise.all([
    source.drop().catch(() => {}),
    desired.drop().catch(() => {}),
    clone?.drop().catch(() => {}),
  ]);
});

describe("overlapping sequence range change preserves the live counter", () => {
  test("MIN lowered + START bumped keeps last_value at 500 (no RESTART)", async () => {
    const sourceState = await extract(source.pool);
    const desiredState = await extract(desired.pool);
    const thePlan = plan(sourceState.factBase, desiredState.factBase);
    const alters = thePlan.actions
      .map((a) => a.sql)
      .filter((s) => s.startsWith("ALTER SEQUENCE"));
    expect(alters).toHaveLength(1);
    expect(alters[0]).not.toContain("RESTART");

    clone = await source.clone();
    const verdict = await provePlan(thePlan, clone.pool, desiredState.factBase);
    expect(verdict.applyError).toBeUndefined();
    expect(verdict.driftDeltas).toEqual([]);
    expect(verdict.ok).toBe(true);

    // the counter is untouched — an overlapping change never resets it.
    const res = await clone.pool.query(`SELECT last_value FROM public.s`);
    expect(String((res.rows[0] as { last_value: string }).last_value)).toBe(
      "500",
    );
  }, 120_000);
});
