/**
 * Load and aggregate dogfooding run artifacts for HTML report generation.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { CompareMetrics, ConvergenceBucket } from "./compare-core.ts";

export type { CompareMetrics, ConvergenceBucket };

export interface SuiteSummaryRow {
  scenario: string;
  kind: string;
  oldStatements: number;
  newStatements: number;
  oldPlanMs: number;
  newPlanMs: number;
  applyBucket?: ConvergenceBucket;
  proveOk?: boolean;
}

export interface BookmarkSummaryRow {
  oldStatements: number;
  newStatements: number;
  oldPlanMs: number;
  newPlanMs: number;
  applyBucket?: ConvergenceBucket;
  proveOk?: boolean;
}

export interface ScenarioReport {
  dirName: string;
  metrics: CompareMetrics;
  oldSql: string;
  newSql: string;
  sqlDiff: string;
  newStatements: string[];
  hasDiff: boolean;
  stmtCountMismatch: boolean;
  speedupRatio: number;
  kind: string;
  planError?: string;
  prove?: CompareMetrics["prove"];
  applyCheck?: CompareMetrics["applyCheck"];
}

export interface ChartSeries {
  planTime: { labels: string[]; oldMs: number[]; newMs: number[] };
  speedup: { labels: string[]; ratios: number[] };
  stmtCounts: { labels: string[]; old: number[]; new: number[] };
  applyBuckets: { bucket: ConvergenceBucket; count: number }[];
}

export interface RunSummary {
  scenarioCount: number;
  stmtCountMismatches: number;
  medianSpeedup: number;
  applyBucketCounts: Partial<Record<ConvergenceBucket, number>>;
  proveFailed: number;
  proveNotRun: number;
  charts: ChartSeries;
}

export interface ReportPayload {
  runDir: string;
  generatedAt: string;
  summary: RunSummary;
  scenarios: ScenarioReport[];
  suiteSummary?: SuiteSummaryRow[];
}

const BUCKET_ORDER: ConvergenceBucket[] = [
  "both-converge",
  "old-fingerprint-gate",
  "accepted-difference-acl",
  "old-fails-new-converges",
  "new-fails-old-converges",
  "both-fail",
  "not-checked",
];

function readOptionalJson<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function readOptionalText(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  return readFileSync(path, "utf8");
}

/** Split SQL file the same way compare-core joins statements. */
export function parseNewStatements(newSql: string): string[] {
  const trimmed = newSql.trim();
  if (!trimmed) return [];
  return trimmed.split(/\n\n+/);
}

/** True when sql.diff has hunks beyond file headers. */
export function hasMeaningfulDiff(sqlDiff: string): boolean {
  const lines = sqlDiff.split("\n");
  return lines.some(
    (line) =>
      line.startsWith("+") ||
      line.startsWith("-") ||
      line.startsWith("@@") ||
      line.startsWith(">") ||
      line.startsWith("<"),
  );
}

export function inferScenarioKind(dirName: string): string {
  if (dirName.startsWith("corpus-")) return "corpus";
  if (dirName.startsWith("dbdev-fixture-")) return "dbdev-fixture";
  if (dirName.startsWith("bookmark-")) return "bookmark";
  return "unknown";
}

export function discoverScenarios(runDir: string): string[] {
  if (!existsSync(runDir)) {
    throw new Error(`Run directory does not exist: ${runDir}`);
  }
  const entries = readdirSync(runDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => join(runDir, e.name))
    .filter((dir) => existsSync(join(dir, "metrics.json")))
    .sort((a, b) => basename(a).localeCompare(basename(b)));
}

export function loadScenarioReport(scenarioDir: string): ScenarioReport {
  const dirName = basename(scenarioDir);
  const metrics = readOptionalJson<CompareMetrics>(
    join(scenarioDir, "metrics.json"),
  );
  if (!metrics) {
    throw new Error(`Missing metrics.json in ${scenarioDir}`);
  }

  const oldSql = readOptionalText(join(scenarioDir, "old.sql")) ?? "";
  const newSql = readOptionalText(join(scenarioDir, "new.sql")) ?? "";
  const sqlDiff = readOptionalText(join(scenarioDir, "sql.diff")) ?? "";
  const planError = readOptionalText(join(scenarioDir, "new-plan-error.txt"));
  const newStatements = parseNewStatements(newSql);
  const stmtCountMismatch =
    metrics.old.statementCount !== metrics.new.statementCount;
  const speedupRatio =
    metrics.timing.newPlanMs > 0
      ? metrics.timing.oldPlanMs / metrics.timing.newPlanMs
      : 0;

  const report: ScenarioReport = {
    dirName,
    metrics,
    oldSql,
    newSql,
    sqlDiff,
    newStatements,
    hasDiff: hasMeaningfulDiff(sqlDiff),
    stmtCountMismatch,
    speedupRatio,
    kind: inferScenarioKind(dirName),
    prove: metrics.prove,
    applyCheck: metrics.applyCheck,
  };
  if (planError !== undefined) report.planError = planError;
  return report;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

export function buildChartSeries(scenarios: ScenarioReport[]): ChartSeries {
  const labels = scenarios.map((s) => s.dirName);
  const oldMs = scenarios.map((s) => s.metrics.timing.oldPlanMs);
  const newMs = scenarios.map((s) => s.metrics.timing.newPlanMs);
  const ratios = scenarios.map((s) =>
    s.speedupRatio > 0 ? Math.round(s.speedupRatio * 10) / 10 : 0,
  );
  const oldStmts = scenarios.map((s) => s.metrics.old.statementCount);
  const newStmts = scenarios.map((s) => s.metrics.new.statementCount);

  const bucketMap = new Map<ConvergenceBucket, number>();
  for (const s of scenarios) {
    const bucket = s.applyCheck?.bucket ?? "not-checked";
    bucketMap.set(bucket, (bucketMap.get(bucket) ?? 0) + 1);
  }
  const applyBuckets = BUCKET_ORDER.filter((b) => bucketMap.has(b)).map(
    (bucket) => ({ bucket, count: bucketMap.get(bucket)! }),
  );

  return {
    planTime: { labels, oldMs, newMs },
    speedup: { labels, ratios },
    stmtCounts: { labels, old: oldStmts, new: newStmts },
    applyBuckets,
  };
}

export function buildRunSummary(scenarios: ScenarioReport[]): RunSummary {
  const applyBucketCounts: Partial<Record<ConvergenceBucket, number>> = {};
  let proveFailed = 0;
  let proveNotRun = 0;

  for (const s of scenarios) {
    const bucket = s.applyCheck?.bucket ?? "not-checked";
    applyBucketCounts[bucket] = (applyBucketCounts[bucket] ?? 0) + 1;
    if (s.prove === undefined) proveNotRun++;
    else if (!s.prove.ok) proveFailed++;
  }

  const speedups = scenarios.map((s) => s.speedupRatio).filter((r) => r > 0);

  return {
    scenarioCount: scenarios.length,
    stmtCountMismatches: scenarios.filter((s) => s.stmtCountMismatch).length,
    medianSpeedup: Math.round(median(speedups) * 10) / 10,
    applyBucketCounts,
    proveFailed,
    proveNotRun,
    charts: buildChartSeries(scenarios),
  };
}

export function loadSuiteSummary(
  runDir: string,
): SuiteSummaryRow[] | undefined {
  return readOptionalJson<SuiteSummaryRow[]>(
    join(runDir, "suite-summary.json"),
  );
}

export function loadBookmarkSummary(
  runDir: string,
): Record<string, BookmarkSummaryRow> | undefined {
  return readOptionalJson<Record<string, BookmarkSummaryRow>>(
    join(runDir, "bookmark-summary.json"),
  );
}

export function buildReportPayload(runDir: string): ReportPayload {
  const scenarioDirs = discoverScenarios(runDir);
  const scenarios = scenarioDirs.map(loadScenarioReport);
  const suiteSummary = loadSuiteSummary(runDir);

  if (suiteSummary) {
    for (const s of scenarios) {
      const shortName = s.dirName.replace(/^corpus-/, "");
      const row = suiteSummary.find(
        (r) =>
          r.scenario === shortName ||
          r.scenario === s.dirName ||
          s.dirName.endsWith(r.scenario),
      );
      if (row) s.kind = row.kind;
    }
  }

  const payload: ReportPayload = {
    runDir,
    generatedAt: new Date().toISOString(),
    summary: buildRunSummary(scenarios),
    scenarios,
  };
  if (suiteSummary !== undefined) payload.suiteSummary = suiteSummary;
  return payload;
}
