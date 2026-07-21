import { describe, expect, test } from "bun:test";
import type { Diagnostic } from "../core/diagnostic.ts";
import { hasBlockingDiagnostics } from "./diagnostics.ts";

const unmodeled: Diagnostic = {
  code: "unmodeled_kind",
  severity: "warning",
  message: "1 unmodeled cast",
};
const orphan: Diagnostic = {
  code: "orphaned_satellite",
  severity: "info",
  message: "dropped",
};
const unresolvedLabel: Diagnostic = {
  code: "unresolved_security_label",
  severity: "warning",
  message: "1 security label on an unsupported object",
};
const err: Diagnostic = { code: "boom", severity: "error", message: "fatal" };

describe("hasBlockingDiagnostics", () => {
  test("an error-severity diagnostic always blocks", () => {
    expect(hasBlockingDiagnostics([err])).toBe(true);
    expect(hasBlockingDiagnostics([err], { strictCoverage: false })).toBe(true);
  });

  test("unmodeled_kind blocks ONLY in strict-coverage mode", () => {
    expect(hasBlockingDiagnostics([unmodeled])).toBe(false);
    expect(hasBlockingDiagnostics([unmodeled], { strictCoverage: true })).toBe(
      true,
    );
  });

  test("unresolved_security_label blocks ONLY in strict-coverage mode", () => {
    // a valid SECURITY LABEL on an unsupported object (language/database/large
    // object/tablespace) would otherwise be silently absent from the artifact
    expect(hasBlockingDiagnostics([unresolvedLabel])).toBe(false);
    expect(
      hasBlockingDiagnostics([unresolvedLabel], { strictCoverage: true }),
    ).toBe(true);
  });

  test("info/warning diagnostics do not block in the default mode", () => {
    expect(hasBlockingDiagnostics([orphan, unmodeled])).toBe(false);
    expect(hasBlockingDiagnostics([])).toBe(false);
  });
});
