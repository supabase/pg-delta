/**
 * Constraint `validated` true → false (VALIDATED → NOT VALID).
 *
 * On a real Postgres round-trip, `pg_get_constraintdef()` bakes the
 * `NOT VALID` suffix into the `def` text itself for CHECK/FK constraints, so
 * `def` (unconditionally "replace") always changes in lockstep with
 * `validated` and the fact is replaced wholesale — this specific transition
 * is unreachable via the corpus. This unit test isolates the `validated`
 * attribute rule directly (same `def` text on both sides, only the boolean
 * flips) to exercise the code path a hand-built FactBase — or a future
 * constraint kind/PG version whose def doesn't encode NOT VALID — could
 * still reach. Pure — no DB.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../../core/fact.ts";
import type { StableId } from "../../core/stable-id.ts";
import { constraintRules } from "./constraints.ts";

const schemaFact: Fact = { id: { kind: "schema", name: "app" }, payload: {} };
const tableFact: Fact = {
  id: { kind: "table", schema: "app", name: "items" },
  parent: { kind: "schema", name: "app" },
  payload: { owner: "test", persistence: "p" },
};
const conId: StableId = {
  kind: "constraint",
  schema: "app",
  table: "items",
  name: "items_order_id_fkey",
};
const def = `FOREIGN KEY (order_id) REFERENCES app.orders(id)`;

const conFact = (validated: boolean): Fact => ({
  id: conId,
  parent: { kind: "table", schema: "app", name: "items" },
  payload: { def, type: "f", validated },
});

describe("constraint validated: true -> false", () => {
  test("false -> true still renders VALIDATE CONSTRAINT", () => {
    const validatedRule = constraintRules.constraint!.attributes["validated"];
    if (typeof validatedRule !== "object")
      throw new Error("validated must be an alter rule");
    const fact = conFact(true);
    const view = buildFactBase([schemaFact, tableFact, fact], []);
    const spec = validatedRule.alter(fact, false, true, view, view);
    const sql = Array.isArray(spec) ? spec.map((s) => s.sql) : [spec.sql];
    expect(sql).toEqual([
      `ALTER TABLE "app"."items" VALIDATE CONSTRAINT "items_order_id_fkey"`,
    ]);
  });

  test("true -> false does not throw — replaces via DROP + ADD ... NOT VALID", () => {
    const validatedRule = constraintRules.constraint!.attributes["validated"];
    if (typeof validatedRule !== "object")
      throw new Error("validated must be an alter rule");
    const fact = conFact(false);
    const view = buildFactBase([schemaFact, tableFact, fact], []);
    expect(() => validatedRule.alter(fact, true, false, view, view)).not.toThrow();
    const spec = validatedRule.alter(fact, true, false, view, view);
    const sql = Array.isArray(spec) ? spec.map((s) => s.sql) : [spec.sql];
    expect(sql).toEqual([
      `ALTER TABLE "app"."items" DROP CONSTRAINT "items_order_id_fkey"`,
      `ALTER TABLE "app"."items" ADD CONSTRAINT "items_order_id_fkey" FOREIGN KEY (order_id) REFERENCES app.orders(id) NOT VALID`,
    ]);
  });
});
