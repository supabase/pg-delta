/**
 * `render` writes a plan's SQL as `<base>.sql` / `<base>_<n>.sql`. Re-rendering
 * to the same base must PRUNE the segment files the previous render owned but
 * this one no longer produces — otherwise a runner scanning the directory
 * replays obsolete (possibly destructive) segments. The naming scheme is the
 * ownership ledger: only files matching `<base>.sql` / `<base>_<n>.sql` are
 * render-owned; any other file in the directory is left untouched.
 */
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  ENGINE_VERSION,
  stampPlanId,
  type Action,
  type Plan,
} from "../../plan/plan.ts";
import { serializePlan } from "../../plan/artifact.ts";
import { cmdRender } from "./render.ts";

function action(overrides: Partial<Action>): Action {
  return {
    sql: "SELECT 1",
    verb: "create",
    produces: [],
    consumes: [],
    destroys: [],
    releases: [],
    transactionality: "transactional",
    lockClass: "none",
    newSegmentBefore: false,
    dataLoss: "none",
    rewriteRisk: false,
    ...overrides,
  } as Action;
}

function makePlan(actions: Action[]): Plan {
  return stampPlanId({
    formatVersion: 1,
    engineVersion: ENGINE_VERSION,
    source: { fingerprint: "a".repeat(64) },
    target: { fingerprint: "b".repeat(64) },
    preamble: [],
    deltas: [],
    filteredDeltas: [],
    renameCandidates: [],
    actions,
    safetyReport: {
      destructiveActions: 0,
      rewriteRiskActions: 0,
      nonTransactionalActions: 0,
      lockClasses: {},
    },
  });
}

/** A 3-segment plan: two commitBoundaryAfter actions force `_1`/`_2`/`_3`. */
const threeSegments = makePlan([
  action({
    sql: "ALTER TYPE color ADD VALUE 'a'",
    transactionality: "commitBoundaryAfter",
  }),
  action({
    sql: "ALTER TYPE color ADD VALUE 'b'",
    transactionality: "commitBoundaryAfter",
  }),
  action({ sql: "CREATE TABLE t (c color)" }),
]);
/** A single-segment plan → `<base>.sql` only. */
const oneSegment = makePlan([
  action({ sql: "CREATE TABLE only (id integer)" }),
]);

describe("cmdRender segment pruning", () => {
  let dir: string;
  const origStdout = process.stdout.write.bind(process.stdout);
  const origStderr = process.stderr.write.bind(process.stderr);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pgdelta-render-"));
    // silence the command's stdout/stderr summary during the test
    process.stdout.write = (() => true) as typeof process.stdout.write;
    process.stderr.write = (() => true) as typeof process.stderr.write;
  });
  afterEach(() => {
    process.stdout.write = origStdout;
    process.stderr.write = origStderr;
  });

  async function render(plan: Plan, outBase: string): Promise<void> {
    const planPath = join(dir, "plan.json");
    writeFileSync(planPath, serializePlan(plan), "utf8");
    await cmdRender(["--plan", planPath, "--out", join(dir, outBase)]);
  }

  test("re-render to the same base removes stale segment files, keeps foreign ones", async () => {
    // a foreign file that render does NOT own (name doesn't match the pattern)
    writeFileSync(join(dir, "mig_notes.sql"), "-- hand authored\n", "utf8");
    writeFileSync(join(dir, "other.sql"), "-- unrelated\n", "utf8");

    await render(threeSegments, "mig.sql");
    expect(existsSync(join(dir, "mig_1.sql"))).toBe(true);
    expect(existsSync(join(dir, "mig_2.sql"))).toBe(true);
    expect(existsSync(join(dir, "mig_3.sql"))).toBe(true);

    // re-render a 1-segment plan → mig.sql; the old mig_1/2/3.sql must be gone
    await render(oneSegment, "mig.sql");

    const sqlFiles = readdirSync(dir)
      .filter((f) => f.endsWith(".sql") && f !== "plan.json")
      .sort();
    expect(sqlFiles).toEqual(["mig.sql", "mig_notes.sql", "other.sql"]);
  });
});
