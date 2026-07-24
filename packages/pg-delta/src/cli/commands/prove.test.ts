/**
 * Unit test for the `prove` CLI failure formatter (second follow-up review
 * 2026-06-15, P2). No database required.
 *
 * A proof can fail on rewrite violations ALONE (a kept table's relfilenode
 * changed under an action that did not declare rewriteRisk). The CLI used to
 * print only "Proof FAILED." for that case, hiding the offending table. The
 * formatter must surface every failure category, mirroring the corpus runner.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cmdProve,
  formatProjectionAudit,
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
import type {
  ProjectionAudit,
  ProjectionAuditEntry,
  ProjectionAuditStage,
} from "../../plan/plan.ts";
import type { ApplyError } from "../../apply/apply.ts";

const baseVerdict = (): ProofVerdict => ({
  ok: false,
  projectionAudit: {
    entries: [],
    summary: { total: 0, suspicious: 0, acknowledged: 0, baseline: 0 },
  },
  driftDeltas: [],
  dataViolations: [],
  rewriteViolations: [],
  coverage: { tablesChecked: 0, tablesSkipped: [], perTable: [] },
});

describe("formatProjectionAudit", () => {
  const entry = (
    name: string,
    classification: ProjectionAuditEntry["classification"],
    stage: ProjectionAuditStage,
    extraSuppression = false,
  ): ProjectionAuditEntry => {
    const id = { kind: "table" as const, schema: "app", name };
    return {
      delta: { verb: "add", fact: { id, payload: {} } },
      subject: { kind: "fact", id },
      classification,
      suppressions: [
        {
          side: "desired",
          stage,
          reasonCode: `${stage}:${name}`,
          classification,
        },
        ...(extraSuppression
          ? [
              {
                side: "source" as const,
                stage,
                reasonCode: `${stage}:${name}:source`,
                classification,
              },
            ]
          : []),
      ],
    };
  };

  test("renders subjects, deltas, classifications, and suppression attribution", () => {
    const audit: ProjectionAudit = {
      entries: [
        {
          delta: {
            verb: "add",
            fact: {
              id: { kind: "column", schema: "app", table: "t", name: "id" },
              parent: { kind: "table", schema: "app", name: "t" },
              payload: { type: "integer" },
            },
          },
          subject: {
            kind: "fact",
            id: { kind: "column", schema: "app", table: "t", name: "id" },
          },
          classification: "suspicious",
          suppressions: [
            {
              side: "desired",
              stage: "policyScopeRule",
              reasonCode: "policy:generic:rule:abc123",
              classification: "suspicious",
              viaDescendantOf: { kind: "table", schema: "app", name: "t" },
            },
          ],
        },
      ],
      summary: { total: 1, suspicious: 1, acknowledged: 0, baseline: 0 },
    };

    expect(formatProjectionAudit(audit)).toMatchInlineSnapshot(`
      "Projection audit: 1 suppressed difference (1 suspicious, 0 acknowledged, 0 baseline)
        add column:app.t.id [suspicious]
          desired policyScopeRule policy:generic:rule:abc123 [suspicious] via table:app.t
      "
      `);
  });

  test("always renders an empty audit section", () => {
    expect(
      formatProjectionAudit({
        entries: [],
        summary: { total: 0, suspicious: 0, acknowledged: 0, baseline: 0 },
      }),
    ).toMatchInlineSnapshot(`
      "Projection audit: 0 suppressed differences (0 suspicious, 0 acknowledged, 0 baseline)
      "
      `);
  });

  test("renders acknowledged baseline edge suppression", () => {
    const edge = {
      from: { kind: "table", schema: "app", name: "t" } as const,
      to: { kind: "schema", name: "app" } as const,
      kind: "depends" as const,
    };
    expect(
      formatProjectionAudit({
        entries: [
          {
            delta: { verb: "link", edge },
            subject: { kind: "edge", edge },
            classification: "acknowledged",
            suppressions: [
              {
                side: "source",
                stage: "baseline",
                reasonCode: "baseline:platform",
                classification: "acknowledged",
              },
            ],
          },
        ],
        summary: { total: 1, suspicious: 0, acknowledged: 1, baseline: 1 },
      }),
    ).toMatchInlineSnapshot(`
      "Projection audit: 1 suppressed difference (0 suspicious, 1 acknowledged, 1 baseline)
        link table:app.t -[depends]-> schema:app [acknowledged]
          source baseline baseline:platform [acknowledged]
      "
      `);
  });

  test("renders the changed attribute for set entries", () => {
    const id = { kind: "table" as const, schema: "app", name: "t" };
    const forward = formatProjectionAudit({
      entries: [
        {
          delta: {
            verb: "set",
            id,
            attr: "persistence",
            from: "permanent",
            to: "unlogged",
          },
          subject: { kind: "fact", id },
          classification: "suspicious",
          suppressions: [
            {
              side: "desired",
              stage: "policyScopeRule",
              reasonCode: "policy:test:hidden-table",
              classification: "suspicious",
            },
          ],
        },
      ],
      summary: { total: 1, suspicious: 1, acknowledged: 0, baseline: 0 },
    });
    const reverse = formatProjectionAudit({
      entries: [
        {
          delta: {
            verb: "set",
            id,
            attr: "persistence",
            from: "unlogged",
            to: "permanent",
          },
          subject: { kind: "fact", id },
          classification: "suspicious",
          suppressions: [
            {
              side: "source",
              stage: "policyScopeRule",
              reasonCode: "policy:test:hidden-table",
              classification: "suspicious",
            },
          ],
        },
      ],
      summary: { total: 1, suspicious: 1, acknowledged: 0, baseline: 0 },
    });

    expect(forward).toContain(
      'set table:app.t.persistence "permanent" → "unlogged" [suspicious]',
    );
    expect(reverse).toContain(
      'set table:app.t.persistence "unlogged" → "permanent" [suspicious]',
    );
    expect(reverse).not.toBe(forward);
  });

  test("renders an endpoint omitted from the artifact as absent", () => {
    const id = { kind: "table" as const, schema: "app", name: "t" };
    expect(
      formatProjectionAudit({
        entries: [
          {
            delta: {
              verb: "set",
              id,
              attr: "newAttribute",
              to: { z: 1, nested: true },
            } as never,
            subject: { kind: "fact", id },
            classification: "suspicious",
            suppressions: [
              {
                side: "desired",
                stage: "policyScopeRule",
                reasonCode: "policy:test:hidden-table",
                classification: "suspicious",
              },
            ],
          },
        ],
        summary: { total: 1, suspicious: 1, acknowledged: 0, baseline: 0 },
      }),
    ).toContain(
      'set table:app.t.newAttribute <absent> → {"nested":true,"z":1} [suspicious]',
    );
  });

  test("bounds very large set endpoints in the human rendering", () => {
    const id = { kind: "table" as const, schema: "app", name: "t" };
    const huge = "x".repeat(20_000);
    const output = formatProjectionAudit({
      entries: [
        {
          delta: {
            verb: "set",
            id,
            attr: "largeValue",
            from: "small",
            to: huge,
          },
          subject: { kind: "fact", id },
          classification: "suspicious",
          suppressions: [
            {
              side: "desired",
              stage: "policyScopeRule",
              reasonCode: "policy:test:large",
              classification: "suspicious",
            },
          ],
        },
      ],
      summary: { total: 1, suspicious: 1, acknowledged: 0, baseline: 0 },
    });

    expect(output.length).toBeLessThan(1_000);
    expect(output).toContain("[truncated]");
    expect(output).not.toContain(huge);
  });

  test("escapes terminal controls in identifiers, reasons, and set endpoints", () => {
    const controlled =
      "safe\nforged\u001b[31m\u0085\u2028line\u2029paragraph\u202ebidi\u2066isolate\u{e0001}";
    const from = {
      kind: "table" as const,
      schema: controlled,
      name: controlled,
    };
    const to = { kind: "schema" as const, name: controlled };
    const audit = {
      entries: [
        {
          delta: {
            verb: "set" as const,
            id: from,
            attr: controlled,
            from: controlled,
            to: controlled,
          },
          subject: { kind: "fact" as const, id: from },
          classification: "suspicious" as const,
          suppressions: [
            {
              side: "desired" as const,
              stage: "policyScopeRule" as const,
              reasonCode: controlled,
              classification: "suspicious" as const,
              viaDescendantOf: to,
            },
          ],
        },
        {
          delta: {
            verb: "link" as const,
            edge: { from, to, kind: "depends" as const },
          },
          subject: {
            kind: "edge" as const,
            edge: { from, to, kind: "depends" as const },
          },
          classification: "suspicious" as const,
          suppressions: [
            {
              side: "desired" as const,
              stage: "capability" as const,
              reasonCode: controlled,
              classification: "suspicious" as const,
            },
          ],
        },
      ],
      summary: { total: 2, suspicious: 2, acknowledged: 0, baseline: 0 },
    };

    const output = formatProjectionAudit(audit);
    expect(output.trimEnd().split("\n")).toHaveLength(5);
    expect(output).toContain("\\u000a");
    expect(output).toContain("\\u001b");
    expect(output).toContain("\\u0085");
    expect(output).toContain("\\u2028");
    expect(output).toContain("\\u2029");
    expect(output).toContain("\\u202e");
    expect(output).toContain("\\u2066");
    expect(output).toContain("\\u{e0001}");
    expect(output).not.toContain("\u2028");
    expect(output).not.toContain("\u2029");
    expect(output).not.toContain("\u202e");
    expect(output).not.toContain("\u2066");
    expect(output).not.toContain("\u{e0001}");
    expect(
      Array.from(output).some((character) => {
        const code = character.codePointAt(0) as number;
        return (
          code <= 0x09 ||
          (code >= 0x0b && code <= 0x1f) ||
          (code >= 0x7f && code <= 0x9f) ||
          /\p{Cf}/u.test(character)
        );
      }),
    ).toBe(false);
  });

  test("caps default detail at 50 entries with suspicious priority and representative acknowledged buckets", () => {
    const suspicious = Array.from({ length: 60 }, (_, index) =>
      entry(
        `suspicious-${index.toString().padStart(2, "0")}`,
        "suspicious",
        "policyScopeRule",
        index === 0,
      ),
    );
    const baseline = entry("baseline-sample", "acknowledged", "baseline");
    const acknowledged = Array.from({ length: 60 }, (_, index) =>
      entry(
        `acknowledged-${index.toString().padStart(2, "0")}`,
        "acknowledged",
        "managedBy",
      ),
    );
    const audit: ProjectionAudit = {
      // Put lower-priority entries first to prove selection is bucketed rather
      // than a plain slice of artifact order.
      entries: [...acknowledged, baseline, ...suspicious],
      summary: {
        total: 121,
        suspicious: 60,
        acknowledged: 61,
        baseline: 1,
      },
    };

    const output = formatProjectionAudit(audit, {
      planPath: "artifacts/review candidate.plan.json",
    });

    expect(output.match(/^  add /gm)).toHaveLength(50);
    expect(output).toContain(
      "Projection audit: 121 suppressed differences (60 suspicious, 61 acknowledged, 1 baseline)",
    );
    expect(output).toContain("add table:app.suspicious-00 [suspicious]");
    expect(output).toContain(
      "desired policyScopeRule policyScopeRule:suspicious-00 [suspicious]",
    );
    expect(output).toContain(
      "source policyScopeRule policyScopeRule:suspicious-00:source [suspicious]",
    );
    expect(output).not.toContain("add table:app.suspicious-48 [suspicious]");
    expect(output).toContain("add table:app.baseline-sample [acknowledged]");
    expect(output).toContain("add table:app.acknowledged-00 [acknowledged]");
    expect(output.indexOf("table:app.suspicious-00")).toBeLessThan(
      output.indexOf("table:app.baseline-sample"),
    );
    expect(output.indexOf("table:app.baseline-sample")).toBeLessThan(
      output.indexOf("table:app.acknowledged-00"),
    );
    expect(output).toContain(
      "Showing 50 of 121 entries. Full audit: artifacts/review candidate.plan.json → projectionAudit; rerun with --audit-all to print every entry.",
    );
    expect(
      formatProjectionAudit(audit, {
        planPath: "artifacts/review candidate.plan.json",
      }),
    ).toBe(output);

    const unsafePath = `artifacts/\u202e${"p".repeat(20_000)}.json`;
    const unsafePathOutput = formatProjectionAudit(audit, {
      planPath: unsafePath,
    });
    expect(unsafePathOutput).toContain("Full audit: artifacts/\\u202e");
    expect(unsafePathOutput).toContain("… [truncated] → projectionAudit");
    expect(unsafePathOutput).not.toContain("\u202e");
    expect(unsafePathOutput).not.toContain(unsafePath);
  });

  test("auditAll prints every entry without a truncation notice", () => {
    const entries = Array.from({ length: 51 }, (_, index) =>
      entry(`suspicious-${index}`, "suspicious", "policyScopeRule"),
    );
    const output = formatProjectionAudit(
      {
        entries,
        summary: {
          total: entries.length,
          suspicious: entries.length,
          acknowledged: 0,
          baseline: 0,
        },
      },
      { auditAll: true },
    );

    expect(output.match(/^  add /gm)).toHaveLength(51);
    expect(output).toContain("add table:app.suspicious-50 [suspicious]");
    expect(output).not.toContain("Showing 50 of 51 entries");
  });

  test("bounds human fields and default suppressions while auditAll lifts only count caps", () => {
    const longIdPart = `id-${"x".repeat(20_000)}`;
    const longReason = `reason-${"y".repeat(20_000)}`;
    const id = { kind: "table" as const, schema: "app", name: longIdPart };
    const suppressions = Array.from({ length: 12 }, (_, index) => ({
      side: "desired" as const,
      stage: "policyScopeRule" as const,
      reasonCode: `${index}:${longReason}`,
      classification: "suspicious" as const,
      viaDescendantOf: {
        kind: "table" as const,
        schema: "app",
        name: longIdPart,
      },
    }));
    const audit: ProjectionAudit = {
      entries: [
        {
          delta: {
            verb: "set",
            id,
            attr: `attr-${"z".repeat(20_000)}`,
            from: "old",
            to: "new",
          },
          subject: { kind: "fact", id },
          classification: "suspicious",
          suppressions,
        },
      ],
      summary: { total: 1, suspicious: 1, acknowledged: 0, baseline: 0 },
    };

    const output = formatProjectionAudit(audit);
    expect(output.match(/^    desired /gm)).toHaveLength(10);
    expect(output).toContain(
      "    ... 2 more suppressions; rerun with --audit-all",
    );
    expect(output).toContain("… [truncated]");
    expect(output.length).toBeLessThan(10_000);
    expect(output).not.toContain(longIdPart);
    expect(output).not.toContain(longReason);

    const allOutput = formatProjectionAudit(audit, { auditAll: true });
    expect(allOutput.match(/^    desired /gm)).toHaveLength(12);
    expect(allOutput).not.toContain("more suppressions");
    expect(allOutput).toContain("… [truncated]");
    expect(allOutput.length).toBeLessThan(12_000);
    expect(allOutput).not.toContain(longIdPart);
    expect(allOutput).not.toContain(longReason);
  });

  test("renders a legacy informational verdict as unavailable, not an audited zero", () => {
    expect(
      formatProjectionAudit(
        {
          entries: [],
          summary: { total: 0, suspicious: 0, acknowledged: 0, baseline: 0 },
        },
        { auditStatus: "unavailable" },
      ),
    ).toBe("Projection audit: unavailable for this legacy plan; re-plan.\n");
  });
});

describe("formatProofFailure (review P2)", () => {
  test("treats a legacy ApplyError without statementKind as an action", () => {
    const legacyApplyError: ApplyError = {
      actionIndex: 2,
      sql: "ALTER TABLE app.t ADD COLUMN value text",
      message: "legacy failure",
    };
    const verdict: ProofVerdict = {
      ...baseVerdict(),
      applyError: legacyApplyError,
    };

    expect(formatProofFailure(verdict)).toContain(
      "apply error at action[2]: legacy failure",
    );
  });

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

  test("explains a strict-audit-only suspicious failure", () => {
    const verdict: ProofVerdict = {
      ...baseVerdict(),
      strictAuditFailure: "suspicious",
    };
    expect(formatProofFailure(verdict)).toContain(
      "strict projection audit failed: suspicious suppressions were found",
    );
  });

  test("explains a strict-audit-only unavailable failure", () => {
    const verdict: ProofVerdict = {
      ...baseVerdict(),
      strictAuditFailure: "unavailable",
    };
    expect(formatProofFailure(verdict)).toContain(
      "strict projection audit failed: this legacy plan has no projection audit",
    );
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
  const artifactDirs = new Set<string>();
  const fb = buildFactBase(
    [{ id: { kind: "schema", name: "public" }, payload: {} }],
    [],
  );

  function writeArtifacts(
    planProfileId: string,
    snapshotProfile: string | null,
    projectionAudit?: ProjectionAudit,
  ): { planPath: string; snapPath: string } {
    const dir = mkdtempSync(join(tmpdir(), "pgdelta-prove-prof-"));
    artifactDirs.add(dir);
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
        ...(projectionAudit === undefined ? {} : { projectionAudit }),
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

  afterEach(() => {
    for (const dir of artifactDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    artifactDirs.clear();
  });

  test("a desired snapshot captured under a DIFFERENT profile fails closed before touching the clone", async () => {
    // plan produced under raw, snapshot captured under supabase → the proof
    // would compare a different managed view; reject up front (UsageError), so
    // the clone URL is never even opened.
    const { planPath, snapPath } = writeArtifacts("raw", "supabase");
    const originalStderrWrite = process.stderr.write.bind(process.stderr);
    let stderr = "";
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderr +=
        typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
      return true;
    }) as typeof process.stderr.write;
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
    } finally {
      process.stderr.write = originalStderrWrite;
    }
    // fails closed with a UsageError, NOT a connection error — the guard runs
    // before makePool opens the clone.
    expect(error).toBeInstanceOf(UsageError);
    expect(stderr).toContain(
      "Projection audit: unavailable for this legacy plan; re-plan.",
    );
  });

  test("accepts --strict-audit before applying the normal preflight guards", async () => {
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
        "--strict-audit",
      ]);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(UsageError);
    expect((error as Error).message).not.toContain("Unknown flag");
    expect((error as Error).message).toContain("desired snapshot was captured");
  });

  test("accepts --audit-all before applying the normal preflight guards", async () => {
    const entries: ProjectionAudit["entries"] = Array.from(
      { length: 51 },
      (_, index) => {
        const id = {
          kind: "table" as const,
          schema: "app",
          name: `hidden_${index}`,
        };
        return {
          delta: { verb: "add" as const, fact: { id, payload: {} } },
          subject: { kind: "fact" as const, id },
          suppressions: [
            {
              side: "desired" as const,
              stage: "policyScopeRule" as const,
              reasonCode: `policy:test:${index}`,
              classification: "suspicious" as const,
            },
          ],
          classification: "suspicious" as const,
        };
      },
    );
    const { planPath, snapPath } = writeArtifacts("raw", "supabase", {
      entries,
      summary: {
        total: entries.length,
        suspicious: entries.length,
        acknowledged: 0,
        baseline: 0,
      },
    });
    const originalStderrWrite = process.stderr.write.bind(process.stderr);
    let stderr = "";
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderr +=
        typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
      return true;
    }) as typeof process.stderr.write;
    let error: unknown;
    try {
      await cmdProve([
        "--plan",
        planPath,
        "--clone",
        "postgres://invalid.invalid:1/none",
        "--desired-snapshot",
        snapPath,
        "--audit-all",
      ]);
    } catch (e) {
      error = e;
    } finally {
      process.stderr.write = originalStderrWrite;
    }
    expect(error).toBeInstanceOf(UsageError);
    expect((error as Error).message).not.toContain("Unknown flag");
    expect((error as Error).message).toContain("desired snapshot was captured");
    expect(stderr.match(/^  add /gm)).toHaveLength(51);
    expect(stderr).not.toContain("Showing 50 of 51 entries");
  });

  test("command usage lists both projection-audit flags", async () => {
    let error: unknown;
    try {
      await cmdProve(["--unknown"]);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(UsageError);
    expect((error as Error).message).toContain(
      "[--strict-audit] [--audit-all]",
    );
  });
});
