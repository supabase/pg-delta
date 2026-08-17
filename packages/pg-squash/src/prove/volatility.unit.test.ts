import { describe, expect, test } from "bun:test";
import { applyVolatilityMask } from "./volatility.ts";
import type { CapturedState, TableProofInput } from "./compare.ts";
import type { LedgerDiff } from "../shadow/index.ts";

const emptyLedger = (): LedgerDiff => ({
  createdRoles: [],
  droppedRoles: [],
  addedMemberships: [],
  removedMemberships: [],
  addedSettings: [],
  removedSettings: [],
});

const table = (content: string | undefined): TableProofInput => ({
  schema: "public",
  name: "t",
  rows: 1,
  schemaSig: "sig",
  ...(content !== undefined ? { content } : {}),
});

const state = (content: string | undefined): CapturedState => ({
  rootHash: "h",
  ledger: emptyLedger(),
  tables: [table(content)],
});

describe("applyVolatilityMask", () => {
  test("keeps stable fingerprints", () => {
    const masked = applyVolatilityMask(state("fp"), state("fp"));
    expect(masked.tables[0]?.content).toBe("fp");
  });

  test("strips fingerprints that differ across original replays", () => {
    const masked = applyVolatilityMask(state("fp-a"), state("fp-b"));
    expect(masked.tables[0]?.content).toBeUndefined();
    expect(masked.tables[0]?.rows).toBe(1);
  });
});
