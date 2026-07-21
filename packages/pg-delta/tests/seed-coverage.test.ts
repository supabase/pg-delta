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
import { enforceSeedCoverage, SeedCoverageError } from "./seed-coverage.ts";

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
});
