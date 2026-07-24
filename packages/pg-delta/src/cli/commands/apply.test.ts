import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENGINE_VERSION } from "../../plan/plan.ts";
import { cmdApply } from "./apply.ts";
import { UsageError } from "../flags.ts";

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected operation to reject");
}

function destructivePlan(): string {
  const dir = mkdtempSync(join(tmpdir(), "pgdelta-apply-loss-"));
  const path = join(dir, "plan.json");
  writeFileSync(
    path,
    JSON.stringify({
      formatVersion: 1,
      engineVersion: ENGINE_VERSION,
      source: { fingerprint: "source" },
      target: { fingerprint: "target" },
      preamble: [],
      deltas: [],
      filteredDeltas: [],
      renameCandidates: [],
      safetyReport: {
        destructiveActions: 0,
        rewriteRiskActions: 0,
        nonTransactionalActions: 0,
        lockClasses: {},
      },
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
          dataLoss: "destructive",
          rewriteRisk: false,
        },
      ],
    }),
  );
  return path;
}

test("apply refuses action-derived data loss before opening the target", async () => {
  const plan = destructivePlan();
  const error = await captureError(
    cmdApply([
      "--plan",
      plan,
      "--target",
      "postgres://unused.invalid:5432/none",
    ]),
  );
  expect(error).toBeInstanceOf(UsageError);
});

test("--force does not also authorize data loss", async () => {
  const plan = destructivePlan();
  const error = await captureError(
    cmdApply([
      "--plan",
      plan,
      "--target",
      "postgres://unused.invalid:5432/none",
      "--force",
    ]),
  );
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain("without --allow-data-loss");
});
