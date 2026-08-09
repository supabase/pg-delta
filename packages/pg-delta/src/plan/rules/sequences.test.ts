/**
 * Sequence option changes must apply ATOMICALLY. Per-field `ALTER SEQUENCE`
 * statements were emitted in diff-field (lexicographic) order, so moving both
 * bounds down (MIN 100/MAX 200 -> MIN 1/MAX 50) ran `MAXVALUE 50` while MIN was
 * still 100 — Postgres rejects the transient range. One combined `ALTER SEQUENCE`
 * validates the FINAL state instead, and realigns the counter (RESTART) when the
 * range moved so far the old current value would fall outside it. Pure rule/diff
 * level — no DB.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../../core/fact.ts";
import type { StableId } from "../../core/stable-id.ts";
import { plan } from "../plan.ts";

const schemaFact: Fact = {
  id: { kind: "schema", name: "app" },
  payload: { owner: "test" },
};
const seqId: StableId = { kind: "sequence", schema: "app", name: "s" };
const seqFact = (options: Record<string, unknown>): Fact => ({
  id: seqId,
  parent: { kind: "schema", name: "app" },
  payload: {
    dataType: "bigint",
    increment: "1",
    minValue: "1",
    maxValue: "9223372036854775807",
    start: "1",
    cache: "1",
    cycle: false,
    ownedBy: null,
    ...options,
  },
});
const base = (extra: Fact[]) => buildFactBase([schemaFact, ...extra], []);

const seqAlters = (from: Fact, to: Fact): string[] =>
  plan(base([from]), base([to]))
    .actions.map((a) => a.sql)
    .filter((s) => s.startsWith("ALTER SEQUENCE"));

describe("sequence option changes apply atomically", () => {
  test("moving both bounds down emits ONE combined ALTER SEQUENCE (final-state valid)", () => {
    const alters = seqAlters(
      seqFact({ minValue: "100", maxValue: "200", start: "100" }),
      seqFact({ minValue: "1", maxValue: "50", start: "1" }),
    );
    expect(alters).toHaveLength(1);
    expect(alters[0]).toContain("MINVALUE 1");
    expect(alters[0]).toContain("MAXVALUE 50");
    expect(alters[0]).toContain("START WITH 1");
    // the range moved entirely below the old one; realign the counter
    expect(alters[0]).toContain("RESTART");
  });

  test("moving both bounds up emits ONE combined ALTER SEQUENCE", () => {
    const alters = seqAlters(
      seqFact({ minValue: "1", maxValue: "50", start: "1" }),
      seqFact({ minValue: "100", maxValue: "200", start: "100" }),
    );
    expect(alters).toHaveLength(1);
    expect(alters[0]).toContain("MINVALUE 100");
    expect(alters[0]).toContain("MAXVALUE 200");
    expect(alters[0]).toContain("RESTART");
  });

  test("a single-option change stays a single minimal statement (no RESTART, no churn)", () => {
    const alters = seqAlters(seqFact({}), seqFact({ cache: "20" }));
    expect(alters).toEqual([`ALTER SEQUENCE "app"."s" CACHE 20`]);
  });

  test("widening the max bound without moving START does not RESTART", () => {
    const alters = seqAlters(
      seqFact({ minValue: "1", maxValue: "50", start: "1" }),
      seqFact({ minValue: "1", maxValue: "500", start: "1" }),
    );
    expect(alters).toHaveLength(1);
    expect(alters[0]).toContain("MAXVALUE 500");
    expect(alters[0]).not.toContain("RESTART");
  });

  test("an OVERLAPPING range change (bound + START both move) must NOT RESTART a live counter", () => {
    // MIN 1→0 + START 1→2 with the max bound unchanged: the ranges [1, MAX] and
    // [0, MAX] overlap, so a live counter (e.g. 500) stays valid. RESTART here
    // would replay already-issued values → duplicate keys. Only a DISJOINT
    // range shift may RESTART.
    const alters = seqAlters(
      seqFact({ minValue: "1", start: "1" }),
      seqFact({ minValue: "0", start: "2" }),
    );
    expect(alters).toHaveLength(1);
    expect(alters[0]).toContain("MINVALUE 0");
    expect(alters[0]).toContain("START WITH 2");
    expect(alters[0]).not.toContain("RESTART");
  });
});
