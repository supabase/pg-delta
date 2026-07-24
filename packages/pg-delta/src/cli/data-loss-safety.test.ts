import { describe, expect, test } from "bun:test";
import type { Action } from "../plan/plan.ts";
import { assertDataLossAllowed, dataLossActions } from "./data-loss-safety.ts";
import { UsageError } from "./flags.ts";

const action = (dataLoss: Action["dataLoss"]): Action => ({
  sql: dataLoss === "destructive" ? "DROP TABLE app.t" : "ALTER TABLE app.t",
  verb: dataLoss === "destructive" ? "drop" : "alter",
  produces: [],
  consumes: [],
  destroys: [],
  releases: [],
  transactionality: "transactional",
  lockClass: "accessExclusive",
  newSegmentBefore: false,
  dataLoss,
  rewriteRisk: false,
});

describe("data-loss safety", () => {
  test("derives destructive operations from actions", () => {
    expect(dataLossActions([action("none"), action("destructive")])).toEqual([
      { actionIndex: 1, sql: "DROP TABLE app.t" },
    ]);
  });

  test("requires a separate explicit approval", () => {
    expect(() =>
      assertDataLossAllowed([action("destructive")], false, "apply"),
    ).toThrow(UsageError);
    expect(() =>
      assertDataLossAllowed([action("destructive")], true, "apply"),
    ).not.toThrow();
    expect(() =>
      assertDataLossAllowed([action("none")], false, "apply"),
    ).not.toThrow();
  });

  test("fails closed for malformed dataLoss metadata from non-artifact callers", () => {
    for (const dataLoss of [undefined, null, "unknown"]) {
      expect(() =>
        dataLossActions([{ ...action("none"), dataLoss } as unknown as Action]),
      ).toThrow(/action\[0\]\.dataLoss/);
    }
  });
});
