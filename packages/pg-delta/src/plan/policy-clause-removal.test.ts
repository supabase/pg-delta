/**
 * Removing a policy's USING / WITH CHECK clause (Codex review): PostgreSQL has
 * no `ALTER POLICY … DROP USING`, so a clause-removal transition must rebuild
 * the (rebuildable) policy. Before the fix the in-place alter called `str(to)`
 * on the null and threw at plan time. Pure rule/diff level — no DB.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import { plan } from "./plan.ts";

const schemaFact: Fact = {
  id: { kind: "schema", name: "app" },
  payload: { owner: "test" },
};
const tableFact: Fact = {
  id: { kind: "table", schema: "app", name: "t" },
  parent: { kind: "schema", name: "app" },
  payload: { owner: "test", persistence: "p" },
};
const policyId: StableId = {
  kind: "policy",
  schema: "app",
  table: "t",
  name: "p",
};
const policyFact = (usingExpr: string | null): Fact => ({
  id: policyId,
  parent: { kind: "table", schema: "app", name: "t" },
  payload: {
    cmd: "*",
    permissive: true,
    roles: ["PUBLIC"],
    usingExpr,
    checkExpr: null,
  },
});
const base = (extra: Fact[]) =>
  buildFactBase([schemaFact, tableFact, ...extra], []);

describe("policy clause removal", () => {
  test("removing USING rebuilds the policy instead of throwing", () => {
    const sql = plan(
      base([policyFact("(true)")]),
      base([policyFact(null)]),
    ).actions.map((a) => a.sql);
    expect(sql.some((s) => s.startsWith(`DROP POLICY "p" ON "app"."t"`))).toBe(
      true,
    );
    expect(
      sql.some((s) => s.startsWith(`CREATE POLICY "p" ON "app"."t"`)),
    ).toBe(true);
    // the rebuilt policy carries no USING clause
    expect(sql.some((s) => s.includes("USING"))).toBe(false);
  });
});
