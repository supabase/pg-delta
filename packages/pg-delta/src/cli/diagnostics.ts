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
 * Whether diagnostics should HALT a command before it produces something to
 * apply:
 *   - an error-severity diagnostic always blocks;
 *   - in strict-coverage mode, an `unmodeled_kind` warning blocks too — the
 *     engine refuses to act while user objects it cannot manage exist.
 */
export function hasBlockingDiagnostics(
  diagnostics: readonly Diagnostic[],
  options: { strictCoverage?: boolean } = {},
): boolean {
  return diagnostics.some(
    (d) =>
      d.severity === "error" ||
      (options.strictCoverage === true && d.code === "unmodeled_kind"),
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
  const unmodeled = diagnostics.filter((d) => d.code === "unmodeled_kind");
  const action = options.action ?? "continue";
  if (options.strictCoverage && unmodeled.length > 0) {
    process.stderr.write(
      `\nRefusing to ${action}: --strict-coverage is set and ${unmodeled.length} ` +
        `unmodeled object kind(s) are present — they are not managed by this engine. ` +
        `Drop them, or rerun without --strict-coverage to proceed with them unmanaged.\n`,
    );
  } else {
    process.stderr.write(
      `\nRefusing to ${action}: blocking diagnostics present (see above).\n`,
    );
  }
  throw new CliExit(3);
}
