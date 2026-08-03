/**
 * provePlan() and extension members, post-flip: the extractor tags every
 * extension-owned object with a `memberOfExtension` provenance edge, and the
 * diff treats members as reference-only (they never become create/drop/alter
 * actions — src/policy/view.ts::extensionMemberReferenceOnly). This test pins
 * the prove-side integration of that contract: a real extension's members flow
 * through extract → plan → provePlan without reading as drift, and without
 * tripping provePlan's source/desired fingerprint gates (the proven re-extract
 * and the plan fingerprints must observe the same managed view of the same
 * real state). Docker required (a sacrificial clone pool).
 *
 * Historical note: this test originally injected a synthetic member through
 * the `reextract` hook to simulate the then-unflipped extractor ("4b Stage 0").
 * That construction hands provePlan a clone whose fingerprint can never match
 * the plan's source fingerprint, which the destructive-workflow guards now
 * (correctly) reject as a sourceStateViolation — so it was replaced with a
 * real extension once the extractor flip landed. Asymmetric member coverage
 * (member satellites changing between sides) lives in the corpus
 * `extension-member--*` scenarios.
 */
import { describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { provePlan } from "../src/proof/prove.ts";
import { createTestDb } from "./containers.ts";

describe("provePlan — default extension-member projection (4b Stage 0)", () => {
  test("extension members in the proven re-extract are not reported as drift", async () => {
    const db = await createTestDb("prove_member");
    try {
      await db.pool.query("CREATE EXTENSION pgcrypto");
      await db.pool.query("CREATE TABLE public.keep (id integer PRIMARY KEY)");
      const state = await extract(db.pool);

      // the extension's members are tagged in the extract
      const memberEdges = state.factBase.edges.filter(
        (edge) => edge.kind === "memberOfExtension",
      );
      expect(memberEdges.length).toBeGreaterThan(0);

      // empty plan: source == desired, so applying it to the clone is a no-op
      const emptyPlan = plan(state.factBase, state.factBase);
      expect(emptyPlan.actions).toHaveLength(0);

      const verdict = await provePlan(emptyPlan, db.pool, state.factBase);

      // pgcrypto's members are present in the proven re-extract; they must not
      // read as drift, and the fingerprint gates must accept the clone.
      expect(verdict.sourceStateViolation).toBeUndefined();
      expect(verdict.desiredStateViolation).toBeUndefined();
      expect(verdict.driftDeltas).toHaveLength(0);
      expect(verdict.ok).toBe(true);
    } finally {
      await db.drop();
    }
  }, 60_000);
});
