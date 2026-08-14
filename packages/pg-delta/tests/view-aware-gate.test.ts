/**
 * apply()/provePlan() must gate against the SAME managed view the plan was
 * produced from (review P0-2). plan() fingerprints the resolveView'd source
 * (policy + capability + extension-member + baseline projection); apply() used
 * to compare the RAW re-extracted target against that resolved fingerprint, so
 * it rejected valid policy/capability-scoped plans whenever an excluded object
 * was present on the real database. Baseline-shaped plans cannot reconstruct
 * the view at all (the baseline is not carried in the artifact), so apply/prove
 * must fail loudly when one is required but not supplied.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { apply } from "../src/apply/apply.ts";
import { extract } from "../src/extract/extract.ts";
import { plan, stampPlanId, type Plan } from "../src/plan/plan.ts";
import type { Policy } from "../src/policy/policy.ts";
import { buildFactBase } from "../src/core/fact.ts";
import { createTestDb, type TestDb } from "./containers.ts";

// scope policy: project the `skipme` schema out of the managed view
const scopePolicy: Policy = {
  id: "skip-internal-schema",
  filter: [{ match: { name: "skipme" }, action: "exclude" }],
};

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb("view-gate");
  await db.pool.query(`CREATE SCHEMA app; CREATE SCHEMA skipme;`);
}, 120_000);

afterAll(async () => {
  await db.drop();
});

describe("view-aware apply/prove fingerprint gate (P0-2)", () => {
  test("default apply gate accepts a policy-scoped plan when the excluded object is present", async () => {
    const state = await extract(db.pool);
    // empty diff against itself, under the policy → a 0-action plan whose
    // source fingerprint is the RESOLVED (skipme-excluded) hash.
    const thePlan = plan(state.factBase, state.factBase, {
      policy: scopePolicy,
    });
    expect(thePlan.actions).toHaveLength(0);

    // RED before the fix: apply re-extracts the RAW db (which still has the
    // `skipme` schema) and compares its rootHash to the resolved fingerprint →
    // mismatch → throws. GREEN: apply reconstructs resolveView(current, policy)
    // before comparing, so the scoped plan is accepted.
    const report = await apply(thePlan, db.pool); // default fingerprintGate = on
    expect(report.status).toBe("applied");
  }, 60_000);

  test("apply fails loudly when the plan was baseline-shaped but no baseline is supplied", async () => {
    const baselinePolicy: Policy = {
      id: "with-baseline",
      baseline: "platform-baseline",
    };
    // a hand-built 0-action plan that records a baseline-declaring policy
    const baselinePlan: Plan = stampPlanId({
      ...plan(buildFactBase([], []), buildFactBase([], [])),
      policy: baselinePolicy,
    });
    let err: unknown;
    try {
      await apply(baselinePlan, db.pool); // no options.baseline
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/baseline/i);
  }, 60_000);
});
