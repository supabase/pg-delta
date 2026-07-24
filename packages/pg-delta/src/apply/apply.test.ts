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
