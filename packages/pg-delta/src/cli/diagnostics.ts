/**
 * One renderer + one gate for the shared `Diagnostic` shape (core/diagnostic.ts).
 *
 * Extraction and the SQL-file loader both return diagnostics; before this
 * module the CLI silently dropped them (review finding 2), so unmodeled-kind
 * detection — and any other warning — was invisible. Every extracting command
 * now prints diagnostics to STDERR (stdout carries machine output like the plan
 * JSON) and, in strict-coverage mode, refuses to produce an apply artifact
 * while the engine cannot manage every user object.
 *
 * The blocking predicate itself is a library frontend
 * (`frontends/diagnostics.ts`); this module keeps the CLI renderer and exit.
 */
import type { Diagnostic } from "../core/diagnostic.ts";
import { encodeId } from "../core/stable-id.ts";
import {
  STRICT_COVERAGE_CODES,
  hasBlockingDiagnostics,
} from "../frontends/diagnostics.ts";
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
        `unmodeled drift / unresolved security labels — see above). ` +
        `Drop them, or rerun without --strict-coverage to proceed with them unmanaged.\n`,
    );
  } else {
    process.stderr.write(
      `\nRefusing to ${action}: blocking diagnostics present (see above).\n`,
    );
  }
  throw new CliExit(3);
}
