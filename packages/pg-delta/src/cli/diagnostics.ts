/**
 * One renderer + one gate for the shared `Diagnostic` shape (core/diagnostic.ts).
 *
 * Extraction and the SQL-file loader both return diagnostics; before this
 * module the CLI silently dropped them (review finding 2), so unmodeled-kind
 * detection — and any other warning — was invisible. Every extracting command
 * now prints diagnostics to STDERR (stdout carries machine output like the plan
 * JSON) and, in strict-coverage mode, refuses to produce an apply artifact
 * while the engine cannot manage every user object.
 */
import type { Diagnostic } from "../core/diagnostic.ts";
import { encodeId } from "../core/stable-id.ts";
import { CliExit } from "./flags.ts";

const SEVERITY_LABEL: Record<Diagnostic["severity"], string> = {
  error: "ERROR",
  warning: "WARNING",
  info: "INFO",
};

/**
 * Print diagnostics to stderr, one line each: `SEVERITY [code] subject: message`.
 * No-op on an empty list. `label` prefixes the source (e.g. "source", "desired").
 */
export function printDiagnostics(
  diagnostics: readonly Diagnostic[],
  options: { label?: string } = {},
): void {
  const prefix = options.label ? `[${options.label}] ` : "";
  for (const d of diagnostics) {
    const subject = d.subject ? ` ${encodeId(d.subject)}:` : "";
    process.stderr.write(
      `${prefix}${SEVERITY_LABEL[d.severity]} [${d.code}]${subject} ${d.message}\n`,
    );
  }
}

/**
 * Diagnostic codes that escalate to blocking under `--strict-coverage`: each
 * marks a user object the engine cannot faithfully carry into the artifact, so
 * strict mode refuses rather than silently ship an incomplete migration.
 *   - `unmodeled_kind`: a user object of a kind the engine does not model.
 *   - `unresolved_security_label`: a valid SECURITY LABEL on an unsupported
 *     object (language / database / large object / tablespace) — it cannot
 *     resolve to a managed id, so the label would be silently missing.
 */
const STRICT_COVERAGE_CODES: ReadonlySet<string> = new Set([
  "unmodeled_kind",
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

/**
 * Throw {@link CliExit}(3) if the (already-printed) diagnostics are blocking —
 * the guard every extracting CLI command applies after printing. Multi-source
 * commands print each source with {@link printDiagnostics} and pass the
 * COMBINED set here so the refusal message reflects the whole run. `action`
 * names what is being refused (e.g. "plan", "apply"). Never returns when
 * blocking (the throw propagates to main(), which maps CliExit → exit 3).
 */
export function exitIfBlocking(
  diagnostics: readonly Diagnostic[],
  options: { strictCoverage?: boolean; action?: string } = {},
): void {
  if (!hasBlockingDiagnostics(diagnostics, options)) return;
  const coverageGaps = diagnostics.filter((d) =>
    STRICT_COVERAGE_CODES.has(d.code),
  );
  const action = options.action ?? "continue";
  if (options.strictCoverage && coverageGaps.length > 0) {
    process.stderr.write(
      `\nRefusing to ${action}: --strict-coverage is set and ${coverageGaps.length} ` +
        `object(s) cannot be faithfully managed by this engine (unmodeled kinds / ` +
        `unresolved security labels — see above). ` +
        `Drop them, or rerun without --strict-coverage to proceed with them unmanaged.\n`,
    );
  } else {
    process.stderr.write(
      `\nRefusing to ${action}: blocking diagnostics present (see above).\n`,
    );
  }
  throw new CliExit(3);
}
