/**
 * The corpus seed-coverage gate must fail LOUDLY even inside an
 * EXPECTED_RED-pinned scenario: the pinned driver swallows a plain `Error`
 * ("red as pinned"), so a seed-coverage regression there would satisfy the pin
 * instead of failing the corpus. `enforceSeedCoverage` therefore throws a
 * distinct `SeedCoverageError`, which the pinned catch re-throws.
 *
 * Pure/unit: feed a synthetic ProofVerdict, no database.
 */
import { describe, expect, test } from "bun:test";
import type { ProofVerdict, SeedOutcome } from "../src/proof/prove.ts";
import {
  enforceSeedCoverage,
  runPinnedDirection,
  SeedCoverageError,
} from "./seed-coverage.ts";

function verdictWith(seedOutcomes: SeedOutcome[]): ProofVerdict {
  return {
    ok: true,
    driftDeltas: [],
    dataViolations: [],
    rewriteViolations: [],
    coverage: { tablesChecked: 0, tablesSkipped: [], perTable: [] },
    seedOutcomes,
  };
}

describe("enforceSeedCoverage error typing", () => {
  test("a `failed` seed outcome throws a SeedCoverageError (not a plain Error)", () => {
    const verdict = verdictWith([
      {
        table: { schema: "s", name: "boom" },
        status: "failed",
        reasonCode: "P0001",
        message: "seed blocked",
      },
    ]);
    let caught: unknown;
    try {
      enforceSeedCoverage("scenario-x", "forward", "scenario-x", verdict);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SeedCoverageError);
  });

  test("an unlisted class-23 skip throws a SeedCoverageError", () => {
    const verdict = verdictWith([
      {
        table: { schema: "s", name: "unlisted" },
        status: "skipped",
        reasonCode: "23502",
      },
    ]);
    expect(() =>
      enforceSeedCoverage("scenario-not-in-allowlist", "forward", "l", verdict),
    ).toThrow(SeedCoverageError);
  });

  test("an all-`seeded` verdict does not throw", () => {
    const verdict = verdictWith([
      { table: { schema: "s", name: "ok" }, status: "seeded" },
    ]);
    expect(() =>
      enforceSeedCoverage("scenario-y", "forward", "l", verdict),
    ).not.toThrow();
  });

  test("an allowlist entry becoming seedable is rejected as stale", () => {
    const verdict = verdictWith([
      { table: { schema: "t", name: "cats" }, status: "seeded" },
    ]);
    expect(() =>
      enforceSeedCoverage(
        "alter-column-type--blocked-by-policy",
        "forward",
        "l",
        verdict,
      ),
    ).toThrow(SeedCoverageError);
  });

  test("an observed allowlisted skip remains accepted", () => {
    const verdict = verdictWith([
      {
        table: { schema: "t", name: "cats" },
        status: "skipped",
        reasonCode: "23502",
      },
    ]);
    expect(() =>
      enforceSeedCoverage(
        "alter-column-type--blocked-by-policy",
        "forward",
        "l",
        verdict,
      ),
    ).not.toThrow();
  });
});

describe("runPinnedDirection (EXPECTED_RED wrapper)", () => {
  test("autoSeed state changes are re-thrown instead of satisfying a red pin", async () => {
    const verdict = {
      ...verdictWith([
        { table: { schema: "s", name: "mutator" }, status: "seeded" },
      ]),
      ok: false,
      seedStateViolation: {
        expectedFingerprint: "expected",
        actualFingerprint: "mutated",
      },
    } as ProofVerdict;

    let caught: unknown;
    try {
      await runPinnedDirection("k:forward", async () => {
        enforceSeedCoverage("k", "forward", "k", verdict);
        throw new Error("ordinary proof failure");
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SeedCoverageError);
  });

  test("autoSeed side effects are re-thrown instead of satisfying a red pin", async () => {
    const verdict = {
      ...verdictWith([
        { table: { schema: "s", name: "mutator" }, status: "seeded" },
      ]),
      ok: false,
      dataViolations: [
        {
          table: { schema: "s", name: "victim" },
          before: 1,
          after: 0,
        },
      ],
      seedSideEffects: [
        {
          table: { schema: "s", name: "victim" },
          before: 1,
          after: 0,
        },
      ],
    } as ProofVerdict;

    let caught: unknown;
    try {
      await runPinnedDirection("k:forward", async () => {
        enforceSeedCoverage("k", "forward", "k", verdict);
        throw new Error("ordinary proof failure");
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SeedCoverageError);
  });

  test("a SeedCoverageError is re-thrown (never swallowed as red-as-pinned)", async () => {
    const boom = new SeedCoverageError("coverage violated");
    let caught: unknown;
    try {
      await runPinnedDirection("k:forward", async () => {
        throw boom;
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SeedCoverageError);
    expect(caught).toBe(boom);
  });

  test("any other error resolves quietly (legitimately red as pinned)", async () => {
    // resolves without throwing — reaching the next line is the assertion.
    const result = await runPinnedDirection("k:forward", async () => {
      throw new Error("ordinary proof failure");
    });
    expect(result).toBeUndefined();
  });

  test("a passing run throws the pinned-but-now-passes error", async () => {
    let caught: unknown;
    try {
      await runPinnedDirection("k:forward", async () => {});
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(
      /pinned in EXPECTED_RED but now PASSES/,
    );
  });
});
