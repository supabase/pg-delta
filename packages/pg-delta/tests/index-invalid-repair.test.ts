/**
 * An INVALID index (pg_index.indisvalid = false — the residue of a failed or
 * cancelled `CREATE INDEX CONCURRENTLY`) must not converge against a desired
 * VALID index. `pg_get_indexdef` renders the same text for both, so before
 * `indisvalid` was captured the unusable index hashed EQUAL to the valid one and
 * the plan was empty (0 actions) — the drift went unrepaired and the proof
 * passed vacuously.
 *
 * The fix captures `indisvalid` as a semantic payload field, so invalid ≠ valid,
 * and routes the transition through the index "replace" strategy (DROP + CREATE)
 * — the standard way to repair an invalid index.
 *
 * We fabricate the invalid state with `UPDATE pg_index SET indisvalid = false`
 * (a superuser DML on the catalog — no allow_system_table_mods needed) rather
 * than racing a real concurrent build.
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
  source = await createTestDb("index-invalid-src");
  desired = await createTestDb("index-invalid-dst");
  // source: a valid index, then forced invalid to simulate a failed
  // CREATE INDEX CONCURRENTLY.
  await source.pool.query(`
    CREATE TABLE public.t (id integer PRIMARY KEY, v integer);
    CREATE INDEX idx_t_v ON public.t (v);
    UPDATE pg_index SET indisvalid = false
    WHERE indexrelid = 'public.idx_t_v'::regclass;
  `);
  // desired: the same index, valid (a fresh CREATE INDEX is always valid).
  await desired.pool.query(`
    CREATE TABLE public.t (id integer PRIMARY KEY, v integer);
    CREATE INDEX idx_t_v ON public.t (v);
  `);
}, 120_000);

afterAll(async () => {
  await Promise.all([
    source.drop().catch(() => {}),
    desired.drop().catch(() => {}),
    clone?.drop().catch(() => {}),
  ]);
});

describe("invalid index repair (replace)", () => {
  test("an invalid index is dropped and recreated, and converges to a valid index", async () => {
    const sourceState = await extract(source.pool);
    const desiredState = await extract(desired.pool);
    const thePlan = plan(sourceState.factBase, desiredState.factBase);
    const indexActions = thePlan.actions
      .map((a) => a.sql)
      .filter(
        (s) => /INDEX "?public"?\."?idx_t_v"?/i.test(s) || /idx_t_v/.test(s),
      );
    // RED before the fix: indexActions is empty (invalid hashed equal to valid).
    expect(indexActions.some((s) => s.startsWith("DROP INDEX"))).toBe(true);
    expect(indexActions.some((s) => s.startsWith("CREATE INDEX"))).toBe(true);

    clone = await source.clone();
    const verdict = await provePlan(thePlan, clone.pool, desiredState.factBase);
    expect(verdict.applyError).toBeUndefined();
    expect(verdict.driftDeltas).toEqual([]);
    expect(verdict.ok).toBe(true);

    // the repaired index is valid again.
    const res = await clone.pool.query(
      `SELECT indisvalid FROM pg_index WHERE indexrelid = 'public.idx_t_v'::regclass`,
    );
    expect((res.rows[0] as { indisvalid: boolean }).indisvalid).toBe(true);
  }, 120_000);
});
