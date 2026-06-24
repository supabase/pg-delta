import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  buildReportPayload,
  buildRunSummary,
  discoverScenarios,
  hasMeaningfulDiff,
  loadScenarioReport,
  parseNewStatements,
} from "./report-core.ts";

const SUITE_RUN = join(
  import.meta.dir,
  "../../../../docs/dogfooding/runs/suite",
);

describe("report-core", () => {
  test("discoverScenarios finds 7 scenarios in committed suite run", () => {
    const dirs = discoverScenarios(SUITE_RUN);
    expect(dirs).toHaveLength(7);
    expect(dirs.map((d) => d.split("/").pop())).toEqual([
      "corpus-function-ops--simple-create",
      "corpus-table-ops--comments",
      "corpus-table-ops--empty-table",
      "corpus-type-ops--enum-create",
      "corpus-view-operations--simple-create",
      "dbdev-fixture-core-roundtrip",
      "dbdev-fixture-zero-diff",
    ]);
  });

  test("hasMeaningfulDiff true for corpus-table-ops--comments", () => {
    const report = loadScenarioReport(
      join(SUITE_RUN, "corpus-table-ops--comments"),
    );
    expect(report.hasDiff).toBe(true);
    expect(hasMeaningfulDiff(report.sqlDiff)).toBe(true);
  });

  test("hasMeaningfulDiff false for zero-diff scenario", () => {
    const report = loadScenarioReport(
      join(SUITE_RUN, "dbdev-fixture-zero-diff"),
    );
    expect(report.hasDiff).toBe(false);
  });

  test("parseNewStatements matches metrics statement counts", () => {
    const report = loadScenarioReport(
      join(SUITE_RUN, "corpus-table-ops--comments"),
    );
    expect(parseNewStatements(report.newSql)).toHaveLength(
      report.metrics.new.statementCount,
    );
    expect(report.metrics.old.statements).toHaveLength(
      report.metrics.old.statementCount,
    );
  });

  test("buildReportPayload aggregates summary and charts", () => {
    const payload = buildReportPayload(SUITE_RUN);
    expect(payload.scenarios).toHaveLength(7);
    expect(payload.summary.scenarioCount).toBe(7);
    expect(payload.summary.charts.planTime.labels).toHaveLength(7);
    expect(payload.summary.charts.applyBuckets.length).toBeGreaterThan(0);
    expect(payload.suiteSummary).toHaveLength(7);
  });

  test("buildRunSummary counts stmt mismatches", () => {
    const payload = buildReportPayload(SUITE_RUN);
    const summary = buildRunSummary(payload.scenarios);
    expect(summary.stmtCountMismatches).toBeGreaterThan(0);
    expect(summary.medianSpeedup).toBeGreaterThan(1);
  });
});
