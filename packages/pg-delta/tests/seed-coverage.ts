/**
 * The corpus auto-seed coverage contract, extracted so it is unit-testable and
 * so the harness can tell a coverage violation apart from a scenario's ordinary
 * proof failure.
 *
 * `enforceSeedCoverage` throws a distinct `SeedCoverageError` (NOT a plain
 * `Error`) on any violation. That matters because the EXPECTED_RED pinned path
 * in engine.test.ts is `try { runDirection() } catch { return }` — a plain
 * error there would be swallowed as "red as pinned", letting a seed-coverage
 * regression hide inside a pinned scenario. The pinned catch re-throws
 * `SeedCoverageError`, so a coverage violation always fails the corpus.
 */
import { writeSync } from "node:fs";
import { rel } from "../src/plan/render.ts";
import type { ProofVerdict } from "../src/proof/prove.ts";
import { isSeedSkipAllowed } from "./autoseed-allowlist.ts";

/** A seed-coverage contract violation. Never a legitimate "red as pinned": the
 *  EXPECTED_RED pinned catch re-throws this so it always fails the corpus. */
export class SeedCoverageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedCoverageError";
  }
}

/**
 * Enforce the corpus auto-seed coverage contract on a proof verdict.
 *  - a `failed` seed outcome (anything NOT a tolerated skip — a raised
 *    exception, connection/permission error, …) fails the scenario loudly; it
 *    is never allowlistable.
 *  - a `skipped` outcome (class-23 SQLSTATE, or the synthetic `no_row` sentinel
 *    for a trigger/rule-suppressed zero-row insert) is tolerated ONLY when its
 *    precise { scenario, direction, table, reasonCode } key is in the
 *    checked-in allowlist (tests/autoseed-allowlist.ts); an unlisted skip fails
 *    the scenario so newly-lost data-preservation coverage can't slip in
 *    silently.
 * A `SEED_AUDIT {json}` line is written to fd 2 before failing so a full corpus
 * run yields ready-to-paste allowlist keys.
 */
export function enforceSeedCoverage(
  scenarioName: string,
  direction: "forward" | "reverse",
  label: string,
  verdict: ProofVerdict,
): void {
  const outcomes = verdict.seedOutcomes ?? [];
  if (outcomes.length === 0) return;
  const coverageMode = (t: { schema: string; name: string }): string =>
    verdict.coverage.perTable.find(
      (p) => p.table.schema === t.schema && p.table.name === t.name,
    )?.contentMode ?? "none";
  const violations: string[] = [];
  for (const o of outcomes) {
    if (o.status === "seeded") continue;
    if (o.status === "failed") {
      writeSync(
        2,
        `SEED_AUDIT ${JSON.stringify({ status: "failed", scenario: scenarioName, direction, table: o.table, reasonCode: o.reasonCode ?? null })}\n`,
      );
      violations.push(
        `  FAILED seed ${rel(o.table.schema, o.table.name)} ` +
          `(coverage=${coverageMode(o.table)}, reason=${o.reasonCode ?? "none"}): ${o.message}`,
      );
      continue;
    }
    // skip (class-23 SQLSTATE or no_row): tolerated only if allowlisted
    if (isSeedSkipAllowed(scenarioName, direction, o.table, o.reasonCode)) {
      continue;
    }
    writeSync(
      2,
      `SEED_AUDIT ${JSON.stringify({ status: "skipped", scenario: scenarioName, direction, table: o.table, reasonCode: o.reasonCode })}\n`,
    );
    violations.push(
      `  UNLISTED skip ${rel(o.table.schema, o.table.name)} ` +
        `(coverage=${coverageMode(o.table)}, reason=${o.reasonCode}) — ` +
        `add to tests/autoseed-allowlist.ts if genuinely unseedable`,
    );
  }
  if (violations.length > 0) {
    throw new SeedCoverageError(
      `[${label}] autoSeed coverage contract violated ` +
        `(scenario=${scenarioName}, direction=${direction}):\n${violations.join("\n")}`,
    );
  }
}
