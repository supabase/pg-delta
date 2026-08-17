import { describe, expect, test } from "bun:test";
import { diffLedger, ledgerDiffIsEmpty } from "./ledger.ts";
import type { LedgerSnapshot } from "./ledger.ts";

const empty: LedgerSnapshot = {
  roles: ["postgres", "test"],
  memberships: [],
  settings: [],
};

describe("diffLedger", () => {
  test("is empty when snapshots match", () => {
    expect(ledgerDiffIsEmpty(diffLedger(empty, empty))).toBe(true);
  });

  test("records created and dropped roles", () => {
    const after: LedgerSnapshot = {
      ...empty,
      roles: ["app", "postgres", "test"],
    };
    const diff = diffLedger(empty, after);
    expect(diff.createdRoles).toEqual(["app"]);
    expect(diff.droppedRoles).toEqual([]);
    expect(ledgerDiffIsEmpty(diff)).toBe(false);

    const reverse = diffLedger(after, empty);
    expect(reverse.droppedRoles).toEqual(["app"]);
  });

  test("records membership and setting deltas", () => {
    const after: LedgerSnapshot = {
      roles: ["app", "postgres", "test"],
      memberships: [{ role: "app", member: "test", adminOption: false }],
      settings: [
        {
          database: null,
          role: "app",
          setconfig: ["statement_timeout=1234"],
        },
      ],
    };
    const diff = diffLedger(empty, after);
    expect(diff.addedMemberships).toEqual([
      { role: "app", member: "test", adminOption: false },
    ]);
    expect(diff.addedSettings).toHaveLength(1);
    expect(diff.removedMemberships).toEqual([]);
    expect(diff.removedSettings).toEqual([]);
  });
});
