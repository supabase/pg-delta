import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import type { StableId } from "../src/core/stable-id.ts";
import type { Action } from "../src/plan/plan.ts";
import {
  ActionShapeBudgetError,
  enforceActionShapeBudget,
  enforceActionShapeBudgetForMode,
  parseActionShapeBudget,
} from "./action-shape-budgets.ts";

const table = (name: string): StableId => ({
  kind: "table",
  schema: "public",
  name,
});

function action(
  verb: Action["verb"],
  ids: {
    produces?: StableId[];
    consumes?: StableId[];
    destroys?: StableId[];
  },
): Action {
  return {
    sql: `${verb} fixture`,
    verb,
    produces: ids.produces ?? [],
    consumes: ids.consumes ?? [],
    destroys: ids.destroys ?? [],
    releases: [],
    transactionality: "transactional",
    lockClass: "none",
    newSegmentBefore: false,
    dataLoss: "none",
    rewriteRisk: false,
  };
}

describe("action-shape budget parsing", () => {
  test("accepts explicit per-direction semantic assertions", () => {
    expect(
      parseActionShapeBudget(
        {
          "a-to-b": {
            require: ["alter:column"],
            forbid: ["replacement:table"],
            expectedFailure: {
              assertion: "require:alter:column",
              issue: "https://github.com/supabase/pg-toolbelt/issues/332",
              reason: "column storage is not extracted",
            },
          },
          "b-to-a": { require: ["replacement:view"] },
        },
        "fixture budget",
      ),
    ).toEqual({
      "a-to-b": {
        require: [{ shape: "alter", kind: "column" }],
        forbid: [{ shape: "replacement", kind: "table" }],
        expectedFailure: {
          assertion: {
            expectation: "require",
            selector: { shape: "alter", kind: "column" },
          },
          issue: "https://github.com/supabase/pg-toolbelt/issues/332",
          reason: "column storage is not extracted",
        },
      },
      "b-to-a": {
        require: [{ shape: "replacement", kind: "view" }],
      },
    });
  });

  test("rejects unknown fields and selector kinds", () => {
    expect(() => parseActionShapeBudget({ forward: {} }, "bad budget")).toThrow(
      /bad budget.*unknown field.*forward/i,
    );
    expect(() =>
      parseActionShapeBudget(
        { "a-to-b": { forbid: ["replacement:not-a-kind"] } },
        "bad budget",
      ),
    ).toThrow(/not-a-kind/);
  });

  test("rejects inert, duplicate, and contradictory budgets", () => {
    expect(() => parseActionShapeBudget({}, "empty budget")).toThrow(
      /at least one direction/i,
    );
    expect(() =>
      parseActionShapeBudget({ "a-to-b": {} }, "empty direction"),
    ).toThrow(/at least one assertion/i);
    expect(() =>
      parseActionShapeBudget(
        { "a-to-b": { require: [] } },
        "empty assertion list",
      ),
    ).toThrow(/require.*must not be empty/i);
    expect(() =>
      parseActionShapeBudget(
        { "a-to-b": { forbid: ["drop:table", "drop:table"] } },
        "duplicate selectors",
      ),
    ).toThrow(/duplicate.*drop:table/i);
    expect(() =>
      parseActionShapeBudget(
        {
          "a-to-b": {
            require: ["replacement:table"],
            forbid: ["replacement:table"],
          },
        },
        "contradictory selectors",
      ),
    ).toThrow(/both required and forbidden.*replacement:table/i);
  });

  test("requires expectedFailure to name a declared assertion", () => {
    expect(() =>
      parseActionShapeBudget(
        {
          "a-to-b": {
            require: ["alter:column"],
            expectedFailure: {
              assertion: "forbid:replacement:table",
              issue: "#332",
              reason: "wrong assertion",
            },
          },
        },
        "bad expected failure",
      ),
    ).toThrow(/assertion.*not declared/i);
  });
});

describe("action-shape budget enforcement", () => {
  test("matches replacements by exact encoded id, not name path", () => {
    const oldOverload: StableId = {
      kind: "function",
      schema: "public",
      name: "f",
      args: ["integer"],
    };
    const newOverload: StableId = {
      kind: "function",
      schema: "public",
      name: "f",
      args: ["text"],
    };
    const budget = parseActionShapeBudget(
      { "a-to-b": { forbid: ["replacement:function"] } },
      "overload budget",
    );

    expect(() =>
      enforceActionShapeBudget(
        [
          action("drop", { destroys: [oldOverload] }),
          action("create", { produces: [newOverload] }),
        ],
        budget,
        "routine-overloads",
        "forward",
      ),
    ).not.toThrow();
  });

  test("reports forbidden replacements with scenario, direction, and ids", () => {
    const users = table("users");
    const budget = parseActionShapeBudget(
      { "a-to-b": { forbid: ["replacement:table"] } },
      "table budget",
    );

    expect(() =>
      enforceActionShapeBudget(
        [
          action("drop", { destroys: [users] }),
          action("create", { produces: [users] }),
        ],
        budget,
        "table-change",
        "forward",
      ),
    ).toThrow(ActionShapeBudgetError);
    expect(() =>
      enforceActionShapeBudget(
        [
          action("drop", { destroys: [users] }),
          action("create", { produces: [users] }),
        ],
        budget,
        "table-change",
        "forward",
      ),
    ).toThrow(
      /table-change.*forward.*replacement:table.*actual=1.*table:public\.users/i,
    );
  });

  test("derives raw alter subjects and subtree renames", () => {
    const users = table("users");
    const customers = table("customers");
    const column: StableId = {
      kind: "column",
      schema: "public",
      table: "users",
      name: "email",
    };
    const budget = parseActionShapeBudget(
      {
        "a-to-b": {
          require: ["alter:column", "alter:table", "rename:table"],
          forbid: ["replacement:table"],
        },
      },
      "rename budget",
    );

    expect(() =>
      enforceActionShapeBudget(
        [
          action("alter", { consumes: [column] }),
          action("alter", {
            produces: [customers],
            consumes: [{ kind: "schema", name: "public" }],
            destroys: [users],
          }),
        ],
        budget,
        "rename-table",
        "forward",
      ),
    ).not.toThrow();
  });

  test("classifies ADD IDENTITY by its altered column, not its produced sequence", () => {
    const column: StableId = {
      kind: "column",
      schema: "public",
      table: "items",
      name: "id",
    };
    const sequence: StableId = {
      kind: "sequence",
      schema: "public",
      name: "items_id_seq",
    };
    const budget = parseActionShapeBudget(
      { "a-to-b": { require: ["alter:column"] } },
      "add identity budget",
    );

    expect(() =>
      enforceActionShapeBudget(
        [
          action("alter", {
            produces: [sequence],
            consumes: [column],
          }),
        ],
        budget,
        "identity-add",
        "forward",
      ),
    ).not.toThrow();
  });

  test("classifies DROP IDENTITY by its altered column, not its destroyed sequence", () => {
    const column: StableId = {
      kind: "column",
      schema: "public",
      table: "items",
      name: "id",
    };
    const sequence: StableId = {
      kind: "sequence",
      schema: "public",
      name: "items_id_seq",
    };
    const budget = parseActionShapeBudget(
      { "a-to-b": { require: ["alter:column"] } },
      "drop identity budget",
    );

    expect(() =>
      enforceActionShapeBudget(
        [
          action("alter", {
            consumes: [column],
            destroys: [sequence],
          }),
        ],
        budget,
        "identity-drop",
        "forward",
      ),
    ).not.toThrow();
  });

  test("expected failures are self-expiring", () => {
    const expectedRed = parseActionShapeBudget(
      {
        "a-to-b": {
          require: ["alter:column"],
          expectedFailure: {
            assertion: "require:alter:column",
            issue: "https://github.com/supabase/pg-toolbelt/issues/332",
            reason: "column storage is not extracted",
          },
        },
      },
      "known-bad budget",
    );

    expect(() =>
      enforceActionShapeBudget([], expectedRed, "column-storage", "forward"),
    ).not.toThrow();

    const column: StableId = {
      kind: "column",
      schema: "public",
      table: "items",
      name: "payload",
    };
    expect(() =>
      enforceActionShapeBudget(
        [action("alter", { consumes: [column] })],
        expectedRed,
        "column-storage",
        "forward",
      ),
    ).toThrow(/expected failure.*#332.*now passes/i);
  });

  test("expected failures do not hide unrelated violations", () => {
    const users = table("users");
    const expectedRed = parseActionShapeBudget(
      {
        "a-to-b": {
          require: ["alter:column"],
          forbid: ["replacement:table"],
          expectedFailure: {
            assertion: "require:alter:column",
            issue: "https://github.com/supabase/pg-toolbelt/issues/332",
            reason: "column storage is not extracted",
          },
        },
      },
      "known-bad budget",
    );

    expect(() =>
      enforceActionShapeBudget(
        [
          action("drop", { destroys: [users] }),
          action("create", { produces: [users] }),
        ],
        expectedRed,
        "column-storage",
        "forward",
      ),
    ).toThrow(/unexpected.*replacement:table/i);
  });

  test("mode gating enforces only the uncompacted artifact", () => {
    const budget = parseActionShapeBudget(
      { "a-to-b": { require: ["alter:column"] } },
      "mode budget",
    );

    expect(() =>
      enforceActionShapeBudgetForMode(
        true,
        [],
        budget,
        "mode-scenario",
        "forward",
      ),
    ).not.toThrow();
    expect(() =>
      enforceActionShapeBudgetForMode(
        false,
        [],
        budget,
        "mode-scenario",
        "forward",
      ),
    ).toThrow(/alter:column/);
  });
});

describe("engine harness wiring", () => {
  test("routes each finished plan through the mode-aware budget gate", () => {
    const source = readFileSync(
      new URL("./engine.test.ts", import.meta.url),
      "utf8",
    );
    expect(source).toMatch(
      /enforceActionShapeBudgetForMode\(\s*compact,\s*thePlan\.actions,\s*actionShapeBudget,/,
    );
  });
});
