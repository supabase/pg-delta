/**
 * Segmentation algorithm (stage 6 deliverable 2), pure: hand-built action
 * lists exercise maximal transactional runs, lone nonTransactional
 * actions, and commitBoundaryAfter boundaries.
 */
import { describe, expect, spyOn, test } from "bun:test";
import type { Pool } from "pg";
import type { Action, Plan } from "../plan/plan.ts";
import { ENGINE_VERSION } from "../plan/plan.ts";
import { apply, type ApplyEvent, segmentActions } from "./apply.ts";

const txn = (newSegmentBefore = false) => ({
  transactionality: "transactional" as const,
  newSegmentBefore,
});
const nonTxn = () => ({
  transactionality: "nonTransactional" as const,
  newSegmentBefore: false,
});
const boundary = () => ({
  transactionality: "commitBoundaryAfter" as const,
  newSegmentBefore: false,
});

describe("segmentActions", () => {
  test("all-transactional plans run as one segment", () => {
    expect(segmentActions([txn(), txn(), txn()])).toEqual([
      { start: 0, end: 3, transactional: true },
    ]);
  });

  test("a nonTransactional action runs alone between transaction runs", () => {
    expect(segmentActions([txn(), nonTxn(), txn(), txn()])).toEqual([
      { start: 0, end: 1, transactional: true },
      { start: 1, end: 2, transactional: false },
      { start: 2, end: 4, transactional: true },
    ]);
  });

  test("leading and trailing nonTransactional actions", () => {
    expect(segmentActions([nonTxn(), txn(), nonTxn()])).toEqual([
      { start: 0, end: 1, transactional: false },
      { start: 1, end: 2, transactional: true },
      { start: 2, end: 3, transactional: false },
    ]);
  });

  test("a commitBoundaryAfter action unconditionally ends its segment (review #6)", () => {
    // ADD VALUE at 1 closes its segment immediately — no reliance on a graph
    // successor being marked. A later newSegmentBefore (at 3) splits again.
    expect(
      segmentActions([txn(), boundary(), txn(), txn(true), txn()]),
    ).toEqual([
      { start: 0, end: 2, transactional: true },
      { start: 2, end: 3, transactional: true },
      { start: 3, end: 5, transactional: true },
    ]);
  });

  test("a boundary at the very first action opens no empty segment", () => {
    expect(segmentActions([txn(true), txn()])).toEqual([
      { start: 0, end: 2, transactional: true },
    ]);
  });

  test("empty plans yield no segments", () => {
    expect(segmentActions([])).toEqual([]);
  });
});

function planWithAction(transactionality: Action["transactionality"]): Plan {
  return {
    formatVersion: 1,
    engineVersion: ENGINE_VERSION,
    source: { fingerprint: "source" },
    target: { fingerprint: "target" },
    preamble: [],
    deltas: [],
    filteredDeltas: [],
    renameCandidates: [],
    actions: [
      {
        sql: "SELECT 42",
        verb: "create",
        produces: [],
        consumes: [],
        destroys: [],
        releases: [],
        transactionality,
        lockClass: "none",
        newSegmentBefore: false,
        dataLoss: "none",
        rewriteRisk: false,
      } as Action,
    ],
    safetyReport: {
      destructiveActions: 0,
      rewriteRiskActions: 0,
      nonTransactionalActions: transactionality === "nonTransactional" ? 1 : 0,
      lockClasses: {},
    },
  } as Plan;
}

async function expectObserverLatencyExcluded(
  transactionality: Action["transactionality"],
): Promise<void> {
  let now = 1_000;
  const nowSpy = spyOn(Date, "now").mockImplementation(() => now);
  const events: ApplyEvent[] = [];
  const client = {
    query: (sql: string) => {
      if (sql === "SELECT 42") now += 7;
      return Promise.resolve({ rows: [] });
    },
    release: () => {},
  };
  const pool = {
    connect: () => Promise.resolve(client),
  } as unknown as Pool;

  try {
    const report = await apply(planWithAction(transactionality), pool, {
      fingerprintGate: false,
      onEvent: (event) => {
        events.push(event);
        if (event.kind === "actionStart") now += 100;
      },
    });

    expect(report.status).toBe("applied");
    const actionEnd = events.find(
      (event): event is Extract<ApplyEvent, { kind: "actionEnd" }> =>
        event.kind === "actionEnd",
    );
    expect(actionEnd?.ms).toBe(7);
  } finally {
    nowSpy.mockRestore();
  }
}

describe("apply action timing", () => {
  test("transactional actionEnd excludes synchronous actionStart observer latency", async () => {
    await expectObserverLatencyExcluded("transactional");
  });

  test("non-transactional actionEnd excludes synchronous actionStart observer latency", async () => {
    await expectObserverLatencyExcluded("nonTransactional");
  });
});

interface ScriptedApply {
  pool: Pool;
  queries: string[];
  releases: Array<Error | boolean | undefined>;
}

function scriptedApplyClient(failingSql: ReadonlySet<string>): ScriptedApply {
  const queries: string[] = [];
  const releases: Array<Error | boolean | undefined> = [];
  const client = {
    query: (sql: string) => {
      queries.push(sql);
      return failingSql.has(sql)
        ? Promise.reject(new Error(`scripted failure: ${sql}`))
        : Promise.resolve({ rows: [] });
    },
    release: (error?: Error | boolean) => releases.push(error),
  };
  return {
    pool: {
      connect: () => Promise.resolve(client),
    } as unknown as Pool,
    queries,
    releases,
  };
}

function planWithPreamble(
  transactionality: Action["transactionality"],
  preamble: Plan["preamble"],
): Plan {
  return { ...planWithAction(transactionality), preamble };
}

function segmentOutcomes(events: ApplyEvent[]): string[] {
  return events
    .filter(
      (event): event is Extract<ApplyEvent, { kind: "segmentEnd" }> =>
        event.kind === "segmentEnd",
    )
    .map((event) => event.outcome);
}

describe("apply control-error attribution", () => {
  test("BEGIN failure reports the exact control and leaves the action unapplied", async () => {
    const scripted = scriptedApplyClient(new Set(["BEGIN"]));
    const events: ApplyEvent[] = [];

    const report = await apply(
      planWithAction("transactional"),
      scripted.pool,
      {
        fingerprintGate: false,
        onEvent: (event) => events.push(event),
      },
    );

    expect(scripted.queries).toEqual(["BEGIN", "ROLLBACK"]);
    expect(report).toMatchObject({
      status: "failed",
      appliedActions: 0,
      actionStatuses: ["unapplied"],
      error: {
        actionIndex: 0,
        statementKind: "control",
        sql: "BEGIN",
        message: "scripted failure: BEGIN",
      },
    });
    expect(events.some((event) => event.kind === "actionStart")).toBe(false);
    expect(events.some((event) => event.kind === "actionEnd")).toBe(false);
    expect(segmentOutcomes(events)).toEqual(["failed"]);
    expect(scripted.releases).toEqual([undefined]);
  });

  test("later transactional preamble failure reports that SET LOCAL and rolls back", async () => {
    const failingSet = "SET LOCAL check_function_bodies = off";
    const scripted = scriptedApplyClient(new Set([failingSet]));
    const events: ApplyEvent[] = [];

    const report = await apply(
      planWithPreamble("transactional", [
        { name: "check_function_bodies", value: "off" },
      ]),
      scripted.pool,
      {
        fingerprintGate: false,
        lockTimeoutMs: 5000,
        onEvent: (event) => events.push(event),
      },
    );

    expect(scripted.queries).toEqual([
      "BEGIN",
      "SET LOCAL lock_timeout = 5000",
      failingSet,
      "ROLLBACK",
    ]);
    expect(report).toMatchObject({
      status: "failed",
      appliedActions: 0,
      actionStatuses: ["unapplied"],
      error: {
        actionIndex: 0,
        statementKind: "control",
        sql: failingSet,
      },
    });
    expect(events.some((event) => event.kind === "actionStart")).toBe(false);
    expect(events.some((event) => event.kind === "actionEnd")).toBe(false);
    expect(segmentOutcomes(events)).toEqual(["failed"]);
  });

  test("transactional action failure remains an action error after successful rollback", async () => {
    const scripted = scriptedApplyClient(new Set(["SELECT 42"]));
    const events: ApplyEvent[] = [];

    const report = await apply(
      planWithAction("transactional"),
      scripted.pool,
      {
        fingerprintGate: false,
        onEvent: (event) => events.push(event),
      },
    );

    expect(scripted.queries).toEqual(["BEGIN", "SELECT 42", "ROLLBACK"]);
    expect(report).toMatchObject({
      status: "failed",
      appliedActions: 0,
      actionStatuses: ["unapplied"],
      error: {
        actionIndex: 0,
        statementKind: "action",
        sql: "SELECT 42",
      },
    });
    expect(segmentOutcomes(events)).toEqual(["rolledBack"]);
    expect(scripted.releases).toEqual([undefined]);
  });

  test("COMMIT failure is an in-doubt control failure even when ROLLBACK succeeds", async () => {
    const scripted = scriptedApplyClient(new Set(["COMMIT"]));
    const events: ApplyEvent[] = [];

    const report = await apply(
      planWithAction("transactional"),
      scripted.pool,
      {
        fingerprintGate: false,
        onEvent: (event) => events.push(event),
      },
    );

    expect(scripted.queries).toEqual([
      "BEGIN",
      "SELECT 42",
      "COMMIT",
      "ROLLBACK",
    ]);
    expect(report).toMatchObject({
      status: "failed",
      appliedActions: 0,
      actionStatuses: ["inDoubt"],
      error: {
        actionIndex: 0,
        statementKind: "control",
        sql: "COMMIT",
      },
    });
    expect(segmentOutcomes(events)).toEqual(["inDoubt"]);
  });

  test("non-transactional preamble failure is failed and never marks the action in doubt", async () => {
    const failingSet = "SET check_function_bodies = invalid";
    const scripted = scriptedApplyClient(new Set([failingSet]));
    const events: ApplyEvent[] = [];

    const report = await apply(
      planWithPreamble("nonTransactional", [
        { name: "check_function_bodies", value: "invalid" },
      ]),
      scripted.pool,
      {
        fingerprintGate: false,
        onEvent: (event) => events.push(event),
      },
    );

    expect(scripted.queries).toEqual([failingSet, "RESET ALL"]);
    expect(report).toMatchObject({
      status: "failed",
      appliedActions: 0,
      actionStatuses: ["unapplied"],
      error: {
        actionIndex: 0,
        statementKind: "control",
        sql: failingSet,
      },
    });
    expect(events.some((event) => event.kind === "actionStart")).toBe(false);
    expect(events.some((event) => event.kind === "actionEnd")).toBe(false);
    expect(segmentOutcomes(events)).toEqual(["failed"]);
  });

  test("non-transactional action failure stays primary and in doubt when RESET ALL also fails", async () => {
    const scripted = scriptedApplyClient(new Set(["SELECT 42", "RESET ALL"]));
    const events: ApplyEvent[] = [];

    const report = await apply(
      planWithAction("nonTransactional"),
      scripted.pool,
      {
        fingerprintGate: false,
        onEvent: (event) => events.push(event),
      },
    );

    expect(scripted.queries).toEqual(["SELECT 42", "RESET ALL"]);
    expect(report).toMatchObject({
      status: "failed",
      appliedActions: 0,
      actionStatuses: ["inDoubt"],
      error: {
        actionIndex: 0,
        statementKind: "action",
        sql: "SELECT 42",
      },
    });
    expect(segmentOutcomes(events)).toEqual(["inDoubt"]);
    expect(scripted.releases).toEqual([true]);
  });

  test("RESET ALL failure after a successful action preserves the applied action", async () => {
    const scripted = scriptedApplyClient(new Set(["RESET ALL"]));
    const events: ApplyEvent[] = [];

    const report = await apply(
      planWithAction("nonTransactional"),
      scripted.pool,
      {
        fingerprintGate: false,
        onEvent: (event) => events.push(event),
      },
    );

    expect(scripted.queries).toEqual(["SELECT 42", "RESET ALL"]);
    expect(report).toMatchObject({
      status: "failed",
      appliedActions: 1,
      actionStatuses: ["applied"],
      error: {
        actionIndex: 0,
        statementKind: "control",
        sql: "RESET ALL",
      },
    });
    expect(segmentOutcomes(events)).toEqual(["failed"]);
    expect(scripted.releases).toEqual([true]);
  });

  test("failed ROLLBACK destroys the client without replacing the primary preamble failure", async () => {
    const failingSet = "SET LOCAL check_function_bodies = invalid";
    const scripted = scriptedApplyClient(new Set([failingSet, "ROLLBACK"]));
    const events: ApplyEvent[] = [];

    const report = await apply(
      planWithPreamble("transactional", [
        { name: "check_function_bodies", value: "invalid" },
      ]),
      scripted.pool,
      {
        fingerprintGate: false,
        onEvent: (event) => events.push(event),
      },
    );

    expect(report.error).toMatchObject({
      statementKind: "control",
      sql: failingSet,
    });
    expect(segmentOutcomes(events)).toEqual(["failed"]);
    expect(scripted.releases).toEqual([true]);
  });
});
