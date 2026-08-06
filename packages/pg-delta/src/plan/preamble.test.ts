/**
 * The preamble's `check_function_bodies = off` entry is governed by the
 * cosmetic compaction contract (§3.6): a compacted plan (the default) carries
 * it only when the plan touches a routine-family object — function, procedure,
 * aggregate, extension, or extension intent, directly or through a satellite —
 * and `compact: false` restores the unconditional preamble as the opt-out.
 * The `search_path` pin is always present. Pure — no DB.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import { plan } from "./plan.ts";
import { renderPlanSql } from "./render-sql.ts";

const schemaId: StableId = { kind: "schema", name: "app" };
const schemaFact: Fact = { id: schemaId, payload: { owner: "test" } };

const tableId: StableId = { kind: "table", schema: "app", name: "t" };
const tableFact: Fact = {
  id: tableId,
  parent: schemaId,
  payload: { owner: "test", persistence: "p" },
};
const colFact: Fact = {
  id: { kind: "column", schema: "app", table: "t", name: "n" },
  parent: tableId,
  payload: {
    type: "integer",
    notNull: false,
    collation: null,
    generatedExpr: null,
  },
};

const fnId: StableId = { kind: "function", schema: "app", name: "f", args: [] };
const fnFact: Fact = {
  id: fnId,
  parent: schemaId,
  payload: {
    def: `CREATE FUNCTION "app"."f"() RETURNS integer LANGUAGE sql AS $$SELECT 1$$`,
  },
};
const fnCommentFact: Fact = {
  id: { kind: "comment", target: fnId },
  parent: fnId,
  payload: { text: "a routine satellite" },
};

const base = (extra: Fact[]) => buildFactBase([schemaFact, ...extra], []);
const preambleNames = (p: { preamble: { name: string }[] }) =>
  p.preamble.map((s) => s.name);

describe("conditional check_function_bodies preamble", () => {
  test("a routine-free plan omits check_function_bodies (search_path retained)", () => {
    const thePlan = plan(base([]), base([tableFact, colFact]));
    expect(thePlan.actions.length).toBeGreaterThan(0);
    expect(preambleNames(thePlan)).toEqual(["search_path"]);
    expect(renderPlanSql(thePlan)).not.toContain("check_function_bodies");
  });

  test("compact: false restores the unconditional preamble (the opt-out)", () => {
    const thePlan = plan(base([]), base([tableFact, colFact]), {
      compact: false,
    });
    expect(preambleNames(thePlan)).toEqual([
      "search_path",
      "check_function_bodies",
    ]);
  });

  test("creating a function keeps check_function_bodies = off", () => {
    const thePlan = plan(base([]), base([fnFact]));
    expect(preambleNames(thePlan)).toEqual([
      "search_path",
      "check_function_bodies",
    ]);
  });

  test("dropping a function keeps check_function_bodies = off", () => {
    const thePlan = plan(base([fnFact]), base([]));
    expect(preambleNames(thePlan)).toEqual([
      "search_path",
      "check_function_bodies",
    ]);
  });

  test("a satellite on a routine keeps check_function_bodies = off", () => {
    // the function itself is identical on both sides — only its COMMENT is
    // added, so the routine appears solely as a satellite target.
    const thePlan = plan(base([fnFact]), base([fnFact, fnCommentFact]));
    expect(thePlan.actions.length).toBeGreaterThan(0);
    expect(preambleNames(thePlan)).toEqual([
      "search_path",
      "check_function_bodies",
    ]);
  });

  test("creating an extension keeps check_function_bodies = off", () => {
    const ext: Fact = {
      id: { kind: "extension", name: "pgmq" },
      payload: { schema: "pgmq", relocatable: false },
    };
    const thePlan = plan(base([]), base([ext]));
    expect(preambleNames(thePlan)).toEqual([
      "search_path",
      "check_function_bodies",
    ]);
  });

  test("an empty plan omits check_function_bodies", () => {
    const thePlan = plan(
      base([tableFact, colFact]),
      base([tableFact, colFact]),
    );
    expect(thePlan.actions).toHaveLength(0);
    expect(preambleNames(thePlan)).toEqual(["search_path"]);
  });
});
