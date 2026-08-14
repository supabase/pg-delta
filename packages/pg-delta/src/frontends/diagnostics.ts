/**
 * Library-facing coverage gate for the shared `Diagnostic` shape
 * (`core/diagnostic.ts`).
 *
 * Error-severity diagnostics always block. Under `strictCoverage`, warnings
 * whose codes are in {@link STRICT_COVERAGE_CODES} block too — each marks a
 * user object the engine cannot faithfully carry into an apply artifact.
 *
 * CLI presentation (`printDiagnostics`) and process exit (`exitIfBlocking`)
 * stay in `src/cli/diagnostics.ts`.
 */
import type { Diagnostic } from "../core/diagnostic.ts";

/**
 * Diagnostic codes that escalate to blocking under `--strict-coverage`: each
 * marks a user object the engine cannot faithfully carry into the artifact, so
 * strict mode refuses rather than silently ship an incomplete migration.
 *   - `unmodeled_kind`: a user object of a kind the engine does not model.
 *   - `unmodeled_drift`: an unmodeled object the DESIRED state has and the
 *     target lacks. Strictly worse than `unmodeled_kind`: no planned statement
 *     can create it (unmodeled kinds produce no facts), so a generated statement
 *     depending on it fails on the target. Strict mode refuses to ship that
 *     artifact until the operator delivers the prerequisite.
 *   - `unresolved_security_label`: a valid SECURITY LABEL on an unsupported
 *     object (language / database / large object / tablespace) — it cannot
 *     resolve to a managed id, so the label would be silently missing.
 */
export const STRICT_COVERAGE_CODES: ReadonlySet<string> = new Set([
  "unmodeled_kind",
  "unmodeled_drift",
  "unresolved_security_label",
]);

/**
 * Whether diagnostics should HALT a command before it produces something to
 * apply:
 *   - an error-severity diagnostic always blocks;
 *   - in strict-coverage mode, a {@link STRICT_COVERAGE_CODES} warning blocks
 *     too — the engine refuses to act while user objects it cannot faithfully
 *     manage exist.
 */
export function hasBlockingDiagnostics(
  diagnostics: readonly Diagnostic[],
  options: { strictCoverage?: boolean } = {},
): boolean {
  return diagnostics.some(
    (d) =>
      d.severity === "error" ||
      (options.strictCoverage === true && STRICT_COVERAGE_CODES.has(d.code)),
  );
}
