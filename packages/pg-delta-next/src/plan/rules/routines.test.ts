/**
 * Routine change classification (§4 def → CREATE OR REPLACE refactor).
 *
 * A function's stored `def` is `pg_get_functiondef` output — itself a
 * `CREATE OR REPLACE FUNCTION …`. A body / volatility / security / strictness /
 * SET-clause change (anything that keeps the same stable id and the same return
 * type, language, and window-kind) re-runs that statement IN PLACE, preserving
 * dependents, owner, and grants (PostgreSQL / pg_dump semantics). Only return
 * type, language, and window-kind — which CREATE OR REPLACE refuses or cannot
 * express — force a drop + recreate (with the forced dependent rebuild).
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../../core/fact.ts";
import { encodeId, type StableId } from "../../core/stable-id.ts";
import type { FactView } from "../rules.ts";
import { routineRules } from "./routines.ts";
import { triggerRules } from "./triggers.ts";

const fnId: StableId = { kind: "function", schema: "s", name: "f", args: [] };
const schemaFact: Fact = { id: { kind: "schema", name: "s" }, payload: {} };

describe("routine `def` is an in-place CREATE OR REPLACE, not a replace", () => {
  test("the `def` attribute is an alter rule (not `replace`)", () => {
    const defRule = routineRules.function!.attributes["def"];
    expect(defRule).not.toBe("replace");
    expect(typeof defRule === "object" && "alter" in defRule).toBe(true);
  });

  test("the def-alter renders the stored def verbatim", () => {
    const defRule = routineRules.function!.attributes["def"];
    if (typeof defRule !== "object") throw new Error("def must be an alter rule");
    const def = `CREATE OR REPLACE FUNCTION "s"."f"() RETURNS integer LANGUAGE sql AS $$SELECT 2$$`;
    const fact: Fact = {
      id: fnId,
      parent: { kind: "schema", name: "s" },
      payload: { def },
    };
    const view = buildFactBase([schemaFact, fact], []);
    const specs = defRule.alter(fact, "old", "new", view, view);
    const spec = Array.isArray(specs) ? specs[0]! : specs;
    expect(spec.sql).toBe(def);
  });

  test("the def-alter consumes the function's desired `depends` targets (BEGIN ATOMIC ordering)", () => {
    const defRule = routineRules.function!.attributes["def"];
    if (typeof defRule !== "object") throw new Error("def must be an alter rule");
    const tableId: StableId = { kind: "table", schema: "s", name: "t" };
    const table: Fact = {
      id: tableId,
      parent: { kind: "schema", name: "s" },
      payload: {},
    };
    const fn: Fact = {
      id: fnId,
      parent: { kind: "schema", name: "s" },
      payload: { def: `CREATE OR REPLACE FUNCTION "s"."f"() ...` },
    };
    const view = buildFactBase(
      [schemaFact, table, fn],
      [{ from: fnId, to: tableId, kind: "depends" }],
    );
    const specs = defRule.alter(fn, "a", "b", view, view);
    const spec = Array.isArray(specs) ? specs[0]! : specs;
    expect((spec.consumes ?? []).map(encodeId)).toContain(encodeId(tableId));
  });

  test("return type, language, and window-kind force a replace (drop + recreate)", () => {
    for (const attr of ["returnType", "language", "isWindow"]) {
      expect(routineRules.function!.attributes[attr]).toBe("replace");
      expect(routineRules.procedure!.attributes[attr]).toBe("replace");
    }
  });
});

describe("eventTrigger stays rebuildable (backing-function demolition)", () => {
  // The `def` refactor makes a function BODY change take the alter path (the ET
  // survives untouched), so the corpus scenario no longer exercises the ET
  // rebuild. The flag still matters whenever a backing function is genuinely
  // demolished (return-type/language/window-kind replace, or REMOVE+ADD): a
  // surviving ET must be dropped before and recreated after. Pinned here since
  // Alpine cannot express a same-id replace of an `() RETURNS event_trigger`
  // plpgsql function to drive it through the corpus.
  test("eventTrigger is rebuildable", () => {
    expect(triggerRules.eventTrigger!.rebuildable).toBe(true);
  });
});
