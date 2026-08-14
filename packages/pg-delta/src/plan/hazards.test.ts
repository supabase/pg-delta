import { describe, expect, test } from "bun:test";
import type { Diagnostic } from "../core/diagnostic.ts";
import { buildFactBase } from "../core/fact.ts";
import { plan, type Action } from "./plan.ts";
import {
  actionHazards,
  classifyPlanHazards,
  HAZARD_KIND_ORDER,
  type HazardKind,
} from "./hazards.ts";

function action(
  overrides: Partial<
    Pick<Action, "dataLoss" | "rewriteRisk" | "transactionality" | "lockClass">
  > = {},
): Action {
  return {
    sql: "SELECT 1",
    verb: "create",
    produces: [],
    consumes: [],
    destroys: [],
    releases: [],
    transactionality: "transactional",
    lockClass: "none",
    newSegmentBefore: false,
    dataLoss: "none",
    rewriteRisk: false,
    ...overrides,
  };
}

function diagnostic(
  code: string,
  severity: Diagnostic["severity"] = "warning",
): Diagnostic {
  return { code, severity, message: code };
}

describe("HAZARD_KIND_ORDER", () => {
  test("is the stable display order", () => {
    expect(HAZARD_KIND_ORDER).toEqual([
      "data_loss",
      "rewrite_risk",
      "non_transactional",
      "access_exclusive_lock",
      "unmodeled_kind",
      "unmodeled_drift",
      "unresolved_security_label",
    ]);
  });

  test("is frozen so callers cannot mutate classification order", () => {
    expect(Object.isFrozen(HAZARD_KIND_ORDER)).toBe(true);
    expect(() => {
      (HAZARD_KIND_ORDER as HazardKind[]).reverse();
    }).toThrow();
  });
});

describe("actionHazards", () => {
  test("dataLoss destructive is data_loss", () => {
    expect(actionHazards(action({ dataLoss: "destructive" }))).toEqual([
      "data_loss",
    ]);
  });

  test("rewriteRisk true is rewrite_risk", () => {
    expect(actionHazards(action({ rewriteRisk: true }))).toEqual([
      "rewrite_risk",
    ]);
  });

  test("nonTransactional is non_transactional", () => {
    expect(
      actionHazards(action({ transactionality: "nonTransactional" })),
    ).toEqual(["non_transactional"]);
  });

  test("accessExclusive lock is access_exclusive_lock", () => {
    expect(actionHazards(action({ lockClass: "accessExclusive" }))).toEqual([
      "access_exclusive_lock",
    ]);
  });

  test("weaker lock classes are not hazards", () => {
    expect(actionHazards(action({ lockClass: "share" }))).toEqual([]);
    expect(actionHazards(action({ lockClass: "shareRowExclusive" }))).toEqual(
      [],
    );
    expect(
      actionHazards(action({ lockClass: "shareUpdateExclusive" })),
    ).toEqual([]);
    expect(actionHazards(action({ lockClass: "none" }))).toEqual([]);
  });

  test("commitBoundaryAfter is not a hazard", () => {
    expect(
      actionHazards(action({ transactionality: "commitBoundaryAfter" })),
    ).toEqual([]);
  });

  test("safe action has no hazards", () => {
    expect(actionHazards(action())).toEqual([]);
  });

  test("multiple kinds on one action are ordered by HAZARD_KIND_ORDER", () => {
    const kinds = actionHazards(
      action({
        dataLoss: "destructive",
        rewriteRisk: true,
        transactionality: "nonTransactional",
        lockClass: "accessExclusive",
      }),
    );
    expect(kinds).toEqual([
      "data_loss",
      "rewrite_risk",
      "non_transactional",
      "access_exclusive_lock",
    ]);
    expect(kinds).toEqual(
      HAZARD_KIND_ORDER.filter((kind) => kinds.includes(kind)),
    );
  });

  test("never returns coverage kinds", () => {
    const kinds = actionHazards(
      action({
        dataLoss: "destructive",
        rewriteRisk: true,
        transactionality: "nonTransactional",
        lockClass: "accessExclusive",
      }),
    );
    const coverage: readonly HazardKind[] = [
      "unmodeled_kind",
      "unmodeled_drift",
      "unresolved_security_label",
    ];
    expect(kinds.some((kind) => coverage.includes(kind))).toBe(false);
  });
});

describe("classifyPlanHazards", () => {
  test("empty plan and no diagnostics is an empty report", () => {
    expect(classifyPlanHazards({ actions: [] })).toEqual({
      actions: [],
      coverage: [],
      kinds: [],
    });
    expect(classifyPlanHazards({ actions: [] }, [])).toEqual({
      actions: [],
      coverage: [],
      kinds: [],
    });
  });

  test("omits actions with no hazards", () => {
    const report = classifyPlanHazards({
      actions: [action(), action({ dataLoss: "destructive" }), action()],
    });
    expect(report.actions).toEqual([{ actionIndex: 1, kinds: ["data_loss"] }]);
    expect(report.coverage).toEqual([]);
    expect(report.kinds).toEqual(["data_loss"]);
  });

  test("indexes match plan.actions", () => {
    const actions = [
      action({ rewriteRisk: true }),
      action(),
      action({ lockClass: "accessExclusive" }),
      action({ dataLoss: "destructive", rewriteRisk: true }),
    ];
    const report = classifyPlanHazards({ actions });
    expect(report.actions.map((entry) => entry.actionIndex)).toEqual([0, 2, 3]);
    expect(report.actions[0]).toEqual({
      actionIndex: 0,
      kinds: ["rewrite_risk"],
    });
    expect(report.actions[1]).toEqual({
      actionIndex: 2,
      kinds: ["access_exclusive_lock"],
    });
    expect(report.actions[2]).toEqual({
      actionIndex: 3,
      kinds: ["data_loss", "rewrite_risk"],
    });
    expect(report.kinds).toEqual([
      "data_loss",
      "rewrite_risk",
      "access_exclusive_lock",
    ]);
  });

  test("coverage diagnostics contribute only to coverage and kinds", () => {
    const report = classifyPlanHazards({ actions: [action()] }, [
      diagnostic("unmodeled_kind"),
      diagnostic("unmodeled_drift"),
      diagnostic("unresolved_security_label"),
    ]);
    expect(report.actions).toEqual([]);
    expect(report.coverage).toEqual([
      "unmodeled_kind",
      "unmodeled_drift",
      "unresolved_security_label",
    ]);
    expect(report.kinds).toEqual([
      "unmodeled_kind",
      "unmodeled_drift",
      "unresolved_security_label",
    ]);
  });

  test("coverage kinds are never attached as ActionHazard", () => {
    const report = classifyPlanHazards(
      { actions: [action({ dataLoss: "destructive" })] },
      [diagnostic("unmodeled_kind")],
    );
    expect(report.actions).toEqual([{ actionIndex: 0, kinds: ["data_loss"] }]);
    expect(report.coverage).toEqual(["unmodeled_kind"]);
    expect(report.kinds).toEqual(["data_loss", "unmodeled_kind"]);
  });

  test("unknown diagnostic codes are ignored", () => {
    const report = classifyPlanHazards({ actions: [] }, [
      diagnostic("orphaned_satellite"),
      diagnostic("intent-unkeyed"),
      diagnostic("not_a_hazard"),
    ]);
    expect(report).toEqual({ actions: [], coverage: [], kinds: [] });
  });

  test("error-severity non-coverage diagnostics are ignored", () => {
    const report = classifyPlanHazards({ actions: [] }, [
      diagnostic("boom", "error"),
      diagnostic("intent-unkeyed", "error"),
    ]);
    expect(report).toEqual({ actions: [], coverage: [], kinds: [] });
  });

  test("coverage codes classify regardless of diagnostic severity", () => {
    const report = classifyPlanHazards({ actions: [] }, [
      diagnostic("unmodeled_kind", "error"),
      diagnostic("unmodeled_drift", "info"),
    ]);
    expect(report.coverage).toEqual(["unmodeled_kind", "unmodeled_drift"]);
    expect(report.kinds).toEqual(["unmodeled_kind", "unmodeled_drift"]);
  });

  test("deduplicates and orders coverage kinds", () => {
    const report = classifyPlanHazards({ actions: [] }, [
      diagnostic("unresolved_security_label"),
      diagnostic("unmodeled_kind"),
      diagnostic("unmodeled_kind"),
      diagnostic("unmodeled_drift"),
    ]);
    expect(report.coverage).toEqual([
      "unmodeled_kind",
      "unmodeled_drift",
      "unresolved_security_label",
    ]);
    expect(report.kinds).toEqual(report.coverage);
  });

  test("kinds is the ordered union of action and coverage hazards", () => {
    const report = classifyPlanHazards(
      {
        actions: [
          action({
            lockClass: "accessExclusive",
            transactionality: "nonTransactional",
          }),
        ],
      },
      [diagnostic("unresolved_security_label"), diagnostic("unmodeled_kind")],
    );
    expect(report.actions).toEqual([
      {
        actionIndex: 0,
        kinds: ["non_transactional", "access_exclusive_lock"],
      },
    ]);
    expect(report.coverage).toEqual([
      "unmodeled_kind",
      "unresolved_security_label",
    ]);
    expect(report.kinds).toEqual([
      "non_transactional",
      "access_exclusive_lock",
      "unmodeled_kind",
      "unresolved_security_label",
    ]);
  });

  test("reads safety fields from a real plan() table drop", () => {
    const schema = { kind: "schema" as const, name: "app" };
    const table = { kind: "table" as const, schema: "app", name: "records" };
    const column = {
      kind: "column" as const,
      schema: "app",
      table: "records",
      name: "id",
    };
    const generated = plan(
      buildFactBase(
        [
          { id: schema, payload: {} },
          { id: table, parent: schema, payload: {} },
          { id: column, parent: table, payload: {} },
        ],
        [],
      ),
      buildFactBase([{ id: schema, payload: {} }], []),
      { compact: false },
    );
    const report = classifyPlanHazards(generated);
    expect(report.kinds).toContain("data_loss");
    expect(report.kinds).toContain("access_exclusive_lock");
    expect(
      report.actions.some((entry) => entry.kinds.includes("data_loss")),
    ).toBe(true);
  });
});
