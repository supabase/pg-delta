/**
 * Apply-segmentation false-positive guard (old function-operations.test.ts ::
 * "keeps functions whose bodies embed non-transactional SQL text in one
 * transactional unit"). This behavior is NOT corpus-observable — both a
 * transactional and a (wrongly) non-transactional plan APPLY identically here,
 * so a roundtrip cannot catch the regression. It is unit-tested instead.
 *
 * A CREATE FUNCTION whose dollar-quoted body merely CONTAINS the text of a
 * non-transactional statement (CREATE INDEX CONCURRENTLY, VACUUM FULL, a
 * work_mem SET, …) must stay `transactional`: the keywords are inert string
 * payload, not statements the migration runs. Transactionality is declared
 * per-rule (routines.ts never sets it → default transactional); this pins that
 * the create action is never misclassified from its body text, and that
 * segmentation keeps such functions in one transactional unit.
 *
 * The opposite direction — a GENUINE non-transactional action (CREATE INDEX
 * CONCURRENTLY) IS segmented — is covered by tests/execution.test.ts.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import { segmentActions } from "../apply/apply.ts";
import { plan } from "./plan.ts";

const schemaFact: Fact = {
  id: { kind: "schema", name: "app" },
  payload: { owner: "test" },
};
const base = (extra: Fact[]) => buildFactBase([schemaFact, ...extra], []);

// a plpgsql function whose body TEXT embeds three non-transactional markers.
const fnId: StableId = {
  kind: "function",
  schema: "app",
  name: "rebuild",
  args: [],
};
const fnFact: Fact = {
  id: fnId,
  parent: { kind: "schema", name: "app" },
  payload: {
    def: `CREATE FUNCTION "app"."rebuild"() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  -- these are just strings in the body, not statements this migration runs:
  -- CREATE INDEX CONCURRENTLY, VACUUM FULL, SET work_mem
  EXECUTE 'CREATE INDEX CONCURRENTLY rebuilt_idx ON app.t (x)';
  EXECUTE 'VACUUM FULL app.t';
  PERFORM set_config('work_mem', '256MB', true);
END
$$`,
  },
};

describe("function body transactionality (apply-segmentation guard)", () => {
  test("a function whose body embeds non-transactional SQL text stays transactional", () => {
    const actions = plan(base([]), base([fnFact])).actions;
    const create = actions.find((a) =>
      /CREATE FUNCTION "app"\."rebuild"/.test(a.sql),
    );
    expect(create).toBeDefined();
    expect(create?.transactionality).toBe("transactional");
    // no action in this plan may be classified non-transactional from body text
    expect(actions.some((a) => a.transactionality === "nonTransactional")).toBe(
      false,
    );
  });

  test("such a function plans into a single transactional segment", () => {
    const actions = plan(base([]), base([fnFact])).actions;
    const segments = segmentActions(actions);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.transactional).toBe(true);
  });
});
