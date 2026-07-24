/**
 * Display helpers for the statement-reordering assist (`schema apply`).
 *
 * With reorder on, the shadow loader operates on synthetic one-statement files
 * named `<ordinal>__<original path>` (e.g. `0007__schema/users.sql`) and bakes
 * those names into its error strings. These helpers map the synthetic name back
 * to the real authored location — `schema/users.sql:line:col` — so the author
 * sees where the offending statement lives, not an internal ordinal name.
 *
 * Pure formatting / offset resolution — no CLI-framework or fs dependency. The
 * Postgres error text is never altered (D6: PG errors remain authoritative);
 * only the synthetic file name is rewritten.
 */
import { ShadowLoadError } from "../frontends/load-sql-files.ts";
import type {
  OrderedSqlFile,
  ShadowLoadCycle,
  ShadowOrderDiagnostic,
  StatementProvenance,
} from "../frontends/sql-order.ts";

/** The ordinal prefix `orderForShadow` prepends: digits then `__`. */
const ORDINAL_PREFIX = /^\d+__/;

/** Strip the `<ordinal>__` prefix from a synthetic reorder name. Names that do
 *  not start with the ordinal pattern are returned unchanged. */
export function stripOrdinalPrefix(name: string): string {
  return name.replace(ORDINAL_PREFIX, "");
}

/**
 * Convert a 1-based character offset in `content` to 1-based line and column.
 * (Ported from pg-delta's apply-display.) Used to resolve a statement's byte
 * offset to a human file location.
 */
export function positionToLineColumn(
  content: string,
  position: number,
): { line: number; column: number } {
  const lines = content.split("\n");
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const lineLen =
      (lines[i] as string).length + (i < lines.length - 1 ? 1 : 0);
    if (position <= offset + lineLen) {
      return { line: i + 1, column: position - offset };
    }
    offset += lineLen;
  }
  const last = lines.length;
  const lastLineLen = lines[last - 1]?.length ?? 0;
  return { line: last, column: lastLineLen + 1 };
}

/**
 * Render a statement's provenance as `file:line:col` when its source offset and
 * the original file content are both known, else the bare `file` path.
 */
export function formatStatementLocation(
  provenance: StatementProvenance,
  originalContent?: string,
): string {
  if (provenance.sourceOffset !== undefined && originalContent !== undefined) {
    const { line, column } = positionToLineColumn(
      originalContent,
      provenance.sourceOffset + 1,
    );
    return `${provenance.filePath}:${line}:${column}`;
  }
  return provenance.filePath;
}

/**
 * Rewrite a {@link ShadowLoadError} produced while loading reordered files so
 * every synthetic `<ordinal>__<path>` name is replaced by the real source
 * location (`file:line:col`). The Postgres message text is preserved verbatim.
 *
 * `originalSqlByName` maps each ORIGINAL file path (provenance.filePath) to its
 * full content, so statement offsets can be resolved to line:column.
 */
export function rewriteReorderedShadowError(
  error: ShadowLoadError,
  ordered: readonly OrderedSqlFile[],
  originalSqlByName: ReadonlyMap<string, string>,
): ShadowLoadError {
  // longest synthetic names first, so one name can't partially match inside
  // another before the full replacement runs.
  const replacements = [...ordered]
    .sort((a, b) => b.name.length - a.name.length)
    .map((file) => ({
      from: file.name,
      to: formatStatementLocation(
        file.provenance,
        originalSqlByName.get(file.provenance.filePath),
      ),
    }));

  const rewrite = (text: string): string =>
    replacements.reduce((acc, { from, to }) => acc.split(from).join(to), text);

  return new ShadowLoadError(
    rewrite(error.message),
    error.details.map((diagnostic) => ({
      ...diagnostic,
      message: rewrite(diagnostic.message),
    })),
  );
}

/** Render one cycle as `loc0 → loc1 → (back to loc0)` using real source
 *  locations when resolvable, plus the involved object keys. */
function formatCycleChain(
  cycle: ShadowLoadCycle,
  originalSqlByName: ReadonlyMap<string, string>,
): string {
  const chain = cycle.members.map((member) =>
    formatStatementLocation(member, originalSqlByName.get(member.filePath)),
  );
  const arrow =
    chain.length > 0
      ? [...chain, `(back to ${chain[0]})`].join(" → ")
      : "(empty cycle)";
  const objects =
    cycle.objectKeys.length > 0
      ? ` [objects: ${cycle.objectKeys.join(", ")}]`
      : "";
  return `${arrow}${objects}`;
}

/**
 * Attach statically-detected shadow-load cycles to a stuck {@link ShadowLoadError}
 * as a clearly-labeled, advisory hint (D6). The Postgres-driven message and
 * details remain first and authoritative — the assist only annotates a failure
 * Postgres already produced, it never decides the load failed.
 *
 * No-op when `cycles` is empty. Call this only for a genuinely non-converging
 * load (stuck / max-rounds); attaching a cycle hint to an unrelated rejection
 * (transaction control, data statements, …) would mislead.
 */
export function appendShadowCycleHint(
  error: ShadowLoadError,
  cycles: readonly ShadowLoadCycle[],
  originalSqlByName: ReadonlyMap<string, string>,
): ShadowLoadError {
  if (cycles.length === 0) {
    return error;
  }

  const chains = cycles.map((cycle) =>
    formatCycleChain(cycle, originalSqlByName),
  );
  const hintBlock = [
    "",
    "Suspected shadow-load cycle(s) detected by the reordering assist " +
      "(static analysis — advisory; the PostgreSQL errors above are authoritative):",
    ...chains.map((chain) => `  ${chain}`),
    "If two objects reference each other, break the cycle by splitting one " +
      "reference into a separate ALTER statement.",
  ].join("\n");

  const hintDetails = cycles.map((cycle) => ({
    code: "suspected_shadow_load_cycle",
    severity: "warning" as const,
    message: `suspected cycle (static analysis, advisory): ${formatCycleChain(cycle, originalSqlByName)}`,
  }));

  return new ShadowLoadError(`${error.message}\n${hintBlock}`, [
    ...error.details,
    ...hintDetails,
  ]);
}

/** pg-topo diagnostic codes that make a `schema lint` run fail (genuine
 *  authoring bugs). `CYCLE_DETECTED` is handled separately via the structured
 *  cycle list. Everything else is advisory (warning) — unresolved references,
 *  for instance, are commonly external (extension-provided) in a partial dir. */
const LINT_ERROR_CODES: ReadonlySet<string> = new Set([
  "PARSE_ERROR",
  "DISCOVERY_ERROR",
  "DUPLICATE_PRODUCER",
]);

/** Result of {@link formatLintReport}: human-readable lines plus counts and a
 *  blocking flag the CLI maps to its exit code. */
export interface LintReport {
  lines: string[];
  errorCount: number;
  warningCount: number;
  blocking: boolean;
}

/**
 * Turn a static-analysis result (`analyzeForShadow`) into a lint report for
 * `schema lint`: one labeled line per finding, with cycles rendered as their
 * `a → b → (back to a)` chain and other pg-topo diagnostics shown at their
 * source location. Purely static — no shadow database is involved (apply stays
 * Postgres-truth). Cycles, parse errors and duplicate producers are blocking;
 * other diagnostics are advisory warnings.
 */
export function formatLintReport(
  result: {
    diagnostics: readonly ShadowOrderDiagnostic[];
    cycles: readonly ShadowLoadCycle[];
  },
  originalSqlByName: ReadonlyMap<string, string>,
): LintReport {
  const lines: string[] = [];
  let errorCount = 0;
  let warningCount = 0;

  for (const cycle of result.cycles) {
    errorCount += 1;
    lines.push(
      `ERROR [CYCLE_DETECTED] ${formatCycleChain(cycle, originalSqlByName)}`,
    );
  }

  for (const diagnostic of result.diagnostics) {
    // cycles are already rendered above from the structured list
    if (diagnostic.code === "CYCLE_DETECTED") {
      continue;
    }
    const isError = LINT_ERROR_CODES.has(diagnostic.code);
    if (isError) {
      errorCount += 1;
    } else {
      warningCount += 1;
    }
    const location = diagnostic.location
      ? formatStatementLocation(
          diagnostic.location,
          originalSqlByName.get(diagnostic.location.filePath),
        )
      : "(no location)";
    lines.push(
      `${isError ? "ERROR" : "WARNING"} [${diagnostic.code}] ${location}: ${diagnostic.message}`,
    );
  }

  return { lines, errorCount, warningCount, blocking: errorCount > 0 };
}
