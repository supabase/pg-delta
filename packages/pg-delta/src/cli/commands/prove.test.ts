/**
 * Unit test for the `prove` CLI failure formatter (second follow-up review
 * 2026-06-15, P2). No database required.
 *
 * A proof can fail on rewrite violations ALONE (a kept table's relfilenode
 * changed under an action that did not declare rewriteRisk). The CLI used to
 * print only "Proof FAILED." for that case, hiding the offending table. The
 * formatter must surface every failure category, mirroring the corpus runner.
 */
import { describe, expect, test } from "bun:test";
import { formatProofFailure, formatProofPassCaveat } from "./prove.ts";
import type { ProofVerdict } from "../../proof/prove.ts";

const baseVerdict = (): ProofVerdict => ({
  ok: false,
  driftDeltas: [],
  dataViolations: [],
  rewriteViolations: [],
  coverage: { tablesChecked: 0, tablesSkipped: [], perTable: [] },
});

describe("formatProofFailure (review P2)", () => {
  test("renders a rewrite-only failure with the offending table", () => {
    const verdict: ProofVerdict = {
      ...baseVerdict(),
      rewriteViolations: [{ table: { schema: "app", name: "t" } }],
    };

    const out = formatProofFailure(verdict);

    expect(out).toContain("rewrite violations (1):");
    expect(out).toContain(
      `    "app"."t": relfilenode changed, no rewriteRisk declared`,
    );
  });

  test("quotes identifiers with dots collision-free", () => {
    const verdict: ProofVerdict = {
      ...baseVerdict(),
      rewriteViolations: [{ table: { schema: "a.b", name: "c" } }],
    };
    // render.ts rel() must quote each part — not split a dotted string
    expect(formatProofFailure(verdict)).toContain(`"a.b"."c"`);
  });
});

describe("formatProofPassCaveat (PR #338 comment 3603601155, drift parity)", () => {
  test("no diagnostics on the desired snapshot — no suffix", () => {
    expect(formatProofPassCaveat(0)).toBe("");
  });

  test("one diagnostic — singular, with count", () => {
    expect(formatProofPassCaveat(1)).toBe(
      " (1 diagnostic on the desired snapshot — see above)",
    );
  });

  test("multiple diagnostics — plural, with count", () => {
    expect(formatProofPassCaveat(3)).toBe(
      " (3 diagnostics on the desired snapshot — see above)",
    );
  });
});
