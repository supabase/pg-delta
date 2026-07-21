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
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cmdProve,
  formatProofFailure,
  formatProofPassCaveat,
  formatProofPassCoverage,
} from "./prove.ts";
import type { ProofCoverage } from "../../proof/prove.ts";
import { buildFactBase } from "../../core/fact.ts";
import { serializeSnapshot } from "../../core/snapshot.ts";
import { ENGINE_VERSION } from "../../plan/plan.ts";
import { UsageError } from "../flags.ts";
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

describe("formatProofPassCoverage (honest data-preservation coverage)", () => {
  const ref = (schema: string, name: string) => ({ schema, name });

  test("everything content-verified — no qualifier (keeps the plain message)", () => {
    const coverage: ProofCoverage = {
      tablesChecked: 2,
      tablesSkipped: [],
      perTable: [
        {
          table: ref("app", "a"),
          contentMode: "fingerprint",
          recreated: false,
          rewriteDeclared: false,
          rowsBefore: 3,
          rowsAfter: 3,
        },
        {
          table: ref("app", "b"),
          contentMode: "fingerprint",
          recreated: false,
          rewriteDeclared: false,
          rowsBefore: 1,
          rowsAfter: 1,
        },
      ],
    };
    expect(formatProofPassCoverage(coverage)).toBe("");
  });

  test("a recreated table is not content-verified — qualifies and names the table", () => {
    const coverage: ProofCoverage = {
      tablesChecked: 1,
      tablesSkipped: [
        { table: ref("app", "orders"), reason: "recreated by the plan" },
      ],
      perTable: [
        {
          table: ref("app", "kept"),
          contentMode: "fingerprint",
          recreated: false,
          rewriteDeclared: false,
          rowsBefore: 2,
          rowsAfter: 2,
        },
      ],
    };
    const out = formatProofPassCoverage(coverage);
    expect(out).toContain("content-verified");
    expect(out).toContain("not compared");
    expect(out).toContain(`"app"."orders"`);
  });

  test("a count-only (schema changed) table qualifies and names the table", () => {
    const coverage: ProofCoverage = {
      tablesChecked: 1,
      tablesSkipped: [],
      perTable: [
        {
          table: ref("app", "widened"),
          contentMode: "count",
          recreated: false,
          rewriteDeclared: false,
          rowsBefore: 5,
          rowsAfter: 5,
        },
      ],
    };
    const out = formatProofPassCoverage(coverage);
    expect(out).toContain("count-only");
    expect(out).toContain(`"app"."widened"`);
  });
});

describe("cmdProve — desired-snapshot profile reconciliation", () => {
  const fb = buildFactBase(
    [{ id: { kind: "schema", name: "public" }, payload: {} }],
    [],
  );

  function writeArtifacts(
    planProfileId: string,
    snapshotProfile: string | null,
  ): { planPath: string; snapPath: string } {
    const dir = mkdtempSync(join(tmpdir(), "pgdelta-prove-prof-"));
    const planPath = join(dir, "plan.json");
    const snapPath = join(dir, "desired.json");
    // a minimal, parse-valid plan artifact stamping the plan's profile id
    writeFileSync(
      planPath,
      JSON.stringify({
        formatVersion: 1,
        engineVersion: ENGINE_VERSION,
        actions: [],
        deltas: [],
        renameCandidates: [],
        safetyReport: { level: "safe", findings: [] },
        redactSecrets: true,
        profile: { id: planProfileId },
        source: { fingerprint: "aaa" },
        target: { fingerprint: "bbb" },
      }),
      "utf8",
    );
    writeFileSync(
      snapPath,
      serializeSnapshot(fb, { pgVersion: "17.6", profile: snapshotProfile }),
      "utf8",
    );
    return { planPath, snapPath };
  }

  test("a desired snapshot captured under a DIFFERENT profile fails closed before touching the clone", async () => {
    // plan produced under raw, snapshot captured under supabase → the proof
    // would compare a different managed view; reject up front (UsageError), so
    // the clone URL is never even opened.
    const { planPath, snapPath } = writeArtifacts("raw", "supabase");
    let error: unknown;
    try {
      await cmdProve([
        "--plan",
        planPath,
        "--clone",
        "postgres://invalid.invalid:1/none",
        "--desired-snapshot",
        snapPath,
      ]);
    } catch (e) {
      error = e;
    }
    // fails closed with a UsageError, NOT a connection error — the guard runs
    // before makePool opens the clone.
    expect(error).toBeInstanceOf(UsageError);
  });
});
