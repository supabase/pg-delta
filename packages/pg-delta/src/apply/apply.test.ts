/**
 * Segmentation algorithm (stage 6 deliverable 2), pure: hand-built action
 * lists exercise maximal transactional runs, lone nonTransactional
 * actions, and commitBoundaryAfter boundaries.
 */
import { describe, expect, test } from "bun:test";
import type { Pool } from "pg";
import { ENGINE_VERSION, type Plan } from "../plan/plan.ts";
import { apply, segmentActions } from "./apply.ts";

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

describe("apply plan integrity", () => {
  test("rejects contradictory destructive metadata before connecting or mutating", async () => {
    let connected = false;
    const target = {
      connect: async () => {
        connected = true;
        throw new Error("must not connect");
      },
    } as unknown as Pool;
    const thePlan = {
      formatVersion: 1,
      engineVersion: ENGINE_VERSION,
      source: { fingerprint: "a".repeat(64) },
      target: { fingerprint: "b".repeat(64) },
      preamble: [],
      deltas: [],
      filteredDeltas: [],
      renameCandidates: [],
      actions: [
        {
          sql: "DROP TABLE app.t",
          verb: "drop",
          produces: [],
          consumes: [],
          destroys: [{ kind: "table", schema: "app", name: "t" }],
          releases: [],
          transactionality: "transactional",
          lockClass: "accessExclusive",
          newSegmentBefore: false,
          dataLoss: "none",
          rewriteRisk: false,
        },
      ],
      safetyReport: {
        destructiveActions: 0,
        rewriteRiskActions: 0,
        nonTransactionalActions: 0,
        lockClasses: { accessExclusive: 1 },
      },
    } satisfies Plan;

    let error: unknown;
    try {
      await apply(thePlan, target, { fingerprintGate: false });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(
      /destroys.*table:app\.t.*dataLoss:none/,
    );
    expect(connected).toBe(false);
  });
});
