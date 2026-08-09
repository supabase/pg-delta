/**
 * Unit tests for commitBoundaryAfter segmentation (hardening Item 5 / review
 * #6). No Docker / database required.
 *
 * A `commitBoundaryAfter` action's effect is not usable before COMMIT (ALTER
 * TYPE … ADD VALUE), so NOTHING after it may share its transaction —
 * unconditionally, regardless of whether a consumer happens to be a graph
 * successor (the fragile assumption the review flagged).
 */
import { describe, expect, test } from "bun:test";
import { segmentActions } from "./apply.ts";

type A = {
  transactionality:
    | "transactional"
    | "nonTransactional"
    | "commitBoundaryAfter";
  newSegmentBefore: boolean;
};
const t: A = { transactionality: "transactional", newSegmentBefore: false };
const boundary: A = {
  transactionality: "commitBoundaryAfter",
  newSegmentBefore: false,
};

describe("segmentActions — commitBoundaryAfter closes its segment", () => {
  const segOf = (segs: ReturnType<typeof segmentActions>, i: number) =>
    segs.findIndex((s) => i >= s.start && i < s.end);

  test("closes the segment even with no newSegmentBefore successor", () => {
    const segs = segmentActions([t, boundary, t]);
    // the boundary action ends the segment it shares with action 0;
    // action 2 lands in a strictly later segment (a commit separates them)
    expect(segOf(segs, 1)).toBe(segOf(segs, 0));
    expect(segOf(segs, 2)).not.toBe(segOf(segs, 1));
    expect(segs.every((s) => s.transactional)).toBe(true);
  });

  test("a trailing commitBoundaryAfter still gets a transactional segment", () => {
    const segs = segmentActions([t, boundary]);
    expect(segOf(segs, 1)).toBe(segOf(segs, 0));
    expect(segs).toHaveLength(1);
  });

  test("two boundaries in a row each close their own segment", () => {
    const segs = segmentActions([boundary, boundary, t]);
    expect(segOf(segs, 0)).not.toBe(segOf(segs, 1));
    expect(segOf(segs, 1)).not.toBe(segOf(segs, 2));
  });
});
