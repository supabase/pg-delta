/**
 * securityLabel rule (pure, no DB): the global satellite rule renders
 * SECURITY LABEL DDL from a fact. End-to-end extraction is exercised in CI
 * behind the dummy_seclabel image (see tests/COVERAGE.md); the SQL shape is
 * proven here without a provider module.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import { plan } from "./plan.ts";

const tableId: StableId = { kind: "table", schema: "app", name: "users" };
const schemaFact: Fact = {
  id: { kind: "schema", name: "app" },
  payload: { owner: "test" },
};
const tableFact: Fact = {
  id: tableId,
  parent: { kind: "schema", name: "app" },
  payload: { owner: "test", persistence: "p" },
};
const labelFact = (label: string): Fact => ({
  id: { kind: "securityLabel", target: tableId, provider: "dummy" },
  parent: tableId,
  payload: { label },
});

const base = (extra: Fact[]) =>
  buildFactBase([schemaFact, tableFact, ...extra], []);

describe("securityLabel rule", () => {
  test("create emits SECURITY LABEL FOR provider ON target IS 'label'", () => {
    const actions = plan(base([]), base([labelFact("classified")])).actions;
    const sql = actions.map((a) => a.sql);
    expect(sql).toContain(
      `SECURITY LABEL FOR 'dummy' ON TABLE "app"."users" IS 'classified'`,
    );
  });

  test("drop emits IS NULL", () => {
    const actions = plan(base([labelFact("classified")]), base([])).actions;
    expect(actions.map((a) => a.sql)).toContain(
      `SECURITY LABEL FOR 'dummy' ON TABLE "app"."users" IS NULL`,
    );
  });

  test("label change is an in-place alter (not drop+create)", () => {
    const actions = plan(
      base([labelFact("classified")]),
      base([labelFact("secret")]),
    ).actions;
    expect(actions).toHaveLength(1);
    expect(actions[0]?.sql).toBe(
      `SECURITY LABEL FOR 'dummy' ON TABLE "app"."users" IS 'secret'`,
    );
  });

  test("a label vanishes with its target (metadata satellite, no explicit drop)", () => {
    // dropping the table cascades; the label is suppressed into the table drop
    const actions = plan(
      base([labelFact("classified")]),
      buildFactBase([], []),
    ).actions;
    expect(actions.some((a) => a.sql.includes("SECURITY LABEL"))).toBe(false);
    expect(actions.some((a) => a.sql.startsWith("DROP TABLE"))).toBe(true);
  });
});
