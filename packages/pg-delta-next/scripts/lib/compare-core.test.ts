/**
 * Regression: v2 pg-delta plans store SQL in `units`, not flat `statements`.
 */
import { describe, expect, test } from "bun:test";
import { flattenOldPlanStatements } from "../../tests/old-engine.ts";
import { decideConvergenceBucket } from "./compare-core.ts";

describe("flattenOldPlanStatements", () => {
  test("flattens v2 unit-based plans", () => {
    const sql = flattenOldPlanStatements({
      version: 2,
      source: { fingerprint: "from" },
      target: { fingerprint: "to" },
      sessionStatements: ['SET ROLE "app"'],
      units: [
        {
          transactionMode: "transactional",
          reason: "default",
          statements: [
            "CREATE TABLE public.users (id integer)",
            "COMMENT ON TABLE public.users IS 'users'",
          ],
        },
      ],
    });
    expect(sql).toEqual([
      'SET ROLE "app"',
      "CREATE TABLE public.users (id integer)",
      "COMMENT ON TABLE public.users IS 'users'",
    ]);
  });

  test("passes through legacy v1 flat statements", () => {
    expect(
      flattenOldPlanStatements({
        version: 1,
        source: { fingerprint: "from" },
        target: { fingerprint: "to" },
        statements: ["CREATE SCHEMA foo"],
      }),
    ).toEqual(["CREATE SCHEMA foo"]);
  });
});

describe("decideConvergenceBucket", () => {
  test("both converge", () => {
    expect(
      decideConvergenceBucket({
        newConverges: true,
        oldConverges: true,
        oldAclDriftOnly: false,
        oldFingerprintGated: false,
      }),
    ).toBe("both-converge");
  });

  test("new converges, old genuinely diverges", () => {
    expect(
      decideConvergenceBucket({
        newConverges: true,
        oldConverges: false,
        oldAclDriftOnly: false,
        oldFingerprintGated: false,
      }),
    ).toBe("old-fails-new-converges");
  });

  test("new converges, old only ACL-drifts", () => {
    expect(
      decideConvergenceBucket({
        newConverges: true,
        oldConverges: false,
        oldAclDriftOnly: true,
        oldFingerprintGated: false,
      }),
    ).toBe("accepted-difference-acl");
  });

  test("old fingerprint gate is distinguished from real divergence", () => {
    expect(
      decideConvergenceBucket({
        newConverges: true,
        oldConverges: false,
        oldAclDriftOnly: false,
        oldFingerprintGated: true,
      }),
    ).toBe("old-fingerprint-gate");
  });

  test("new fails while old converges", () => {
    expect(
      decideConvergenceBucket({
        newConverges: false,
        oldConverges: true,
        oldAclDriftOnly: false,
        oldFingerprintGated: false,
      }),
    ).toBe("new-fails-old-converges");
  });

  test("both fail", () => {
    expect(
      decideConvergenceBucket({
        newConverges: false,
        oldConverges: false,
        oldAclDriftOnly: false,
        oldFingerprintGated: false,
      }),
    ).toBe("both-fail");
  });
});
