/**
 * Non-transactional apply: session settings must be reset even when the action
 * fails, and a failed non-transactional action is inDoubt (not unapplied),
 * because it may have left durable side effects (review P1).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import pg from "pg";
import { apply } from "../src/apply/apply.ts";
import { ENGINE_VERSION, type Plan } from "../src/plan/plan.ts";
import { createTestDb, type TestDb } from "./containers.ts";

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb("apply-nontx");
}, 120_000);

afterAll(async () => {
  await db.drop();
});

function planWithFailingNonTxnAction(): Plan {
  return {
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
        sql: "SELECT 1 / 0", // fails at runtime
        verb: "alter",
        produces: [],
        consumes: [],
        destroys: [],
        releases: [],
        transactionality: "nonTransactional",
        lockClass: "none",
        newSegmentBefore: false,
        dataLoss: "none",
        rewriteRisk: false,
      },
    ],
    safetyReport: {
      destructiveActions: 0,
      rewriteRiskActions: 0,
      nonTransactionalActions: 1,
      lockClasses: { none: 1 },
    },
  };
}

describe("non-transactional apply: reset + inDoubt (P1)", () => {
  test("a failed non-transactional action is inDoubt and the session is reset", async () => {
    // max:1 so the SAME backend serves the apply and the follow-up SHOW.
    const probe = new pg.Pool({ connectionString: db.uri, max: 1 });
    probe.on("error", () => {});
    try {
      const report = await apply(planWithFailingNonTxnAction(), probe, {
        fingerprintGate: false,
        lockTimeoutMs: 7000, // SESSION-level for a non-txn action
      });
      expect(report.status).toBe("failed");
      // inDoubt, NOT unapplied — the action may have durable side effects
      expect(report.actionStatuses[0]).toBe("inDoubt");
      expect(report.error).toMatchObject({
        actionIndex: 0,
        statementKind: "action",
        sql: "SELECT 1 / 0",
      });
      // RESET ALL ran in finally despite the failure → back to the default
      const { rows } = await probe.query("SHOW lock_timeout");
      expect((rows[0] as { lock_timeout: string }).lock_timeout).toBe("0");
    } finally {
      await probe.end();
    }
  }, 60_000);
});
