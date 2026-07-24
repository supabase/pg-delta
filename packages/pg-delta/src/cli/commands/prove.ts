/**
 * prove --plan <plan.json> --clone <pg-url> --desired-snapshot <file>
 *
 * Run the proof loop against a sacrificial clone of the source.
 * WARNING: the clone is mutated and will no longer reflect the source.
 */
import { readFileSync } from "node:fs";
import { parsePlan } from "../../plan/artifact.ts";
import { rel } from "../../plan/render.ts";
import {
  provePlan,
  type ProofCoverage,
  type ProofVerdict,
  type TableRef,
} from "../../proof/prove.ts";
import type {
  ProjectionAudit,
  ProjectionAuditSubject,
} from "../../plan/plan.ts";
import { loadSnapshot } from "../../frontends/snapshot-file.ts";
import { canonicalize, type PayloadValue } from "../../core/hash.ts";
import { encodeId } from "../../core/stable-id.ts";
import { exitIfBlocking, printDiagnostics } from "../diagnostics.ts";
import { makePool } from "../pool.ts";
import { CliExit, parseFlags, UsageError } from "../flags.ts";
import {
  effectiveProfileId,
  isProfilePath,
  loadProfile,
  PROFILE_IDS,
  reconcileBaselineDigest,
  resolveCliProfile,
} from "../profile.ts";

/**
 * Render a failing `ProofVerdict` as an indented, human-readable report (the
 * lines printed after "Proof FAILED."). Pure + exported so the CLI output is
 * testable without a database. Every category the verdict can fail on gets a
 * block — apply error, drift, data violations, AND rewrite violations — so a
 * proof failure is always self-explanatory (review P2: rewrite-only failures
 * used to print just "Proof FAILED.").
 */
export function formatProofFailure(verdict: ProofVerdict): string {
  const lines: string[] = [];
  if (verdict.strictAuditFailure === "suspicious") {
    lines.push(
      "  strict projection audit failed: suspicious suppressions were found",
    );
  } else if (verdict.strictAuditFailure === "unavailable") {
    lines.push(
      "  strict projection audit failed: this legacy plan has no projection audit; re-plan before using --strict-audit",
    );
  }
  if (verdict.applyError) {
    const subject =
      verdict.applyError.statementKind === "action"
        ? `action[${verdict.applyError.actionIndex}]`
        : "control";
    lines.push(`  apply error at ${subject}: ${verdict.applyError.message}`);
  }
  if (verdict.driftDeltas.length > 0) {
    lines.push(`  drift deltas (${verdict.driftDeltas.length}):`);
    for (const d of verdict.driftDeltas) {
      const id =
        d.verb === "add" || d.verb === "remove"
          ? encodeId(d.fact.id)
          : d.verb === "set"
            ? encodeId(d.id)
            : encodeId(d.edge.from);
      lines.push(`    ${d.verb} ${id}`);
    }
  }
  if (verdict.dataViolations.length > 0) {
    lines.push(`  data violations (${verdict.dataViolations.length}):`);
    for (const v of verdict.dataViolations) {
      lines.push(
        `    ${rel(v.table.schema, v.table.name)}: before=${v.before} after=${v.after}`,
      );
    }
  }
  if (verdict.rewriteViolations.length > 0) {
    lines.push(`  rewrite violations (${verdict.rewriteViolations.length}):`);
    for (const v of verdict.rewriteViolations) {
      lines.push(
        `    ${rel(v.table.schema, v.table.name)}: relfilenode changed, no rewriteRisk declared`,
      );
    }
  }
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

/** Keep every artifact-controlled field on its intended terminal line and
 * neutralize terminal directionality/formatting controls. */
function escapeAuditField(value: string): string {
  let escaped = "";
  for (const character of value) {
    const code = character.codePointAt(0) as number;
    escaped +=
      code <= 0x1f ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x2028 ||
      code === 0x2029 ||
      /\p{Cf}/u.test(character)
        ? code <= 0xffff
          ? `\\u${code.toString(16).padStart(4, "0")}`
          : `\\u{${code.toString(16)}}`
        : character;
  }
  return escaped;
}

const DEFAULT_PROJECTION_AUDIT_ENTRY_LIMIT = 50;
const DEFAULT_PROJECTION_AUDIT_SUPPRESSION_LIMIT = 10;
const PROJECTION_AUDIT_FIELD_LIMIT = 240;

function truncateAuditField(value: string): string {
  const characters = Array.from(value);
  if (characters.length <= PROJECTION_AUDIT_FIELD_LIMIT) return value;
  return `${characters.slice(0, PROJECTION_AUDIT_FIELD_LIMIT).join("")}… [truncated]`;
}

function formatAuditField(value: string): string {
  return truncateAuditField(escapeAuditField(value));
}

function formatAuditSubject(subject: ProjectionAuditSubject): string {
  if (subject.kind === "fact") return formatAuditField(encodeId(subject.id));
  const { edge } = subject;
  return `${formatAuditField(encodeId(edge.from))} -[${formatAuditField(edge.kind)}]-> ${formatAuditField(encodeId(edge.to))}`;
}

function formatAuditEndpoint(
  delta: Extract<ProjectionAudit["entries"][number]["delta"], { verb: "set" }>,
  endpoint: "from" | "to",
): string {
  if (!Object.hasOwn(delta, endpoint)) return "<absent>";
  const value = delta[endpoint] as PayloadValue;
  // An own `undefined` can exist in an in-memory Delta but cannot cross the JSON
  // artifact boundary. Keep it distinct from a genuinely omitted endpoint and
  // avoid passing it to canonicalize, which deliberately rejects top-level
  // undefined.
  if (value === undefined) return "<undefined>";
  return formatAuditField(canonicalize(value));
}

interface ProjectionAuditFormatOptions {
  /** Print every entry rather than the bounded human-readable projection. */
  auditAll?: boolean;
  /** Distinguishes a normalized legacy empty audit from an audited zero. */
  auditStatus?: "available" | "unavailable";
  /** Exact artifact path supplied to `--plan`, for truncation discoverability. */
  planPath?: string;
}

function isBaselineAuditEntry(
  entry: ProjectionAudit["entries"][number],
): boolean {
  return entry.suppressions.some(
    (suppression) => suppression.stage === "baseline",
  );
}

/** Select the bounded human projection deterministically. Reserve one baseline
 * entry and one non-baseline acknowledged entry when present, then fill with
 * suspicious, baseline, and other acknowledged entries in that priority order.
 * Artifact order is preserved within each bucket. */
function selectProjectionAuditEntries(
  audit: ProjectionAudit,
): ProjectionAudit["entries"] {
  if (audit.entries.length <= DEFAULT_PROJECTION_AUDIT_ENTRY_LIMIT) {
    return audit.entries;
  }

  const selected = new Set<ProjectionAudit["entries"][number]>();
  const reserve = (
    entry: ProjectionAudit["entries"][number] | undefined,
  ): void => {
    if (entry !== undefined) selected.add(entry);
  };
  reserve(audit.entries.find(isBaselineAuditEntry));
  reserve(
    audit.entries.find(
      (entry) =>
        entry.classification === "acknowledged" && !isBaselineAuditEntry(entry),
    ),
  );

  const buckets = [
    audit.entries.filter((entry) => entry.classification === "suspicious"),
    audit.entries.filter(isBaselineAuditEntry),
    audit.entries.filter((entry) => entry.classification === "acknowledged"),
  ];
  for (const bucket of buckets) {
    for (const entry of bucket) {
      if (selected.size === DEFAULT_PROJECTION_AUDIT_ENTRY_LIMIT) break;
      selected.add(entry);
    }
    if (selected.size === DEFAULT_PROJECTION_AUDIT_ENTRY_LIMIT) break;
  }

  const bucketPriority = (entry: ProjectionAudit["entries"][number]): number =>
    entry.classification === "suspicious"
      ? 0
      : isBaselineAuditEntry(entry)
        ? 1
        : 2;
  return audit.entries
    .filter((entry) => selected.has(entry))
    .sort((a, b) => bucketPriority(a) - bucketPriority(b));
}

/** Render suppressed raw differences and their stable attribution. This is
 * emitted for passing and failing proofs alike: strictness changes exit status,
 * never visibility. Human detail is bounded by default; the audit artifact and
 * summary always remain complete. */
export function formatProjectionAudit(
  audit: ProjectionAudit,
  options: ProjectionAuditFormatOptions = {},
): string {
  if (options.auditStatus === "unavailable") {
    return "Projection audit: unavailable for this legacy plan; re-plan.\n";
  }
  const { summary } = audit;
  const difference = summary.total === 1 ? "difference" : "differences";
  const lines = [
    `Projection audit: ${summary.total} suppressed ${difference} (${summary.suspicious} suspicious, ${summary.acknowledged} acknowledged, ${summary.baseline} baseline)`,
  ];
  const entries = options.auditAll
    ? audit.entries
    : selectProjectionAuditEntries(audit);
  for (const entry of entries) {
    const verb = formatAuditField(entry.delta.verb);
    const classification = formatAuditField(entry.classification);
    const detail =
      entry.delta.verb === "set"
        ? `.${formatAuditField(entry.delta.attr)} ${formatAuditEndpoint(entry.delta, "from")} → ${formatAuditEndpoint(entry.delta, "to")}`
        : "";
    lines.push(
      `  ${verb} ${formatAuditSubject(entry.subject)}${detail} [${classification}]`,
    );
    const suppressions = options.auditAll
      ? entry.suppressions
      : entry.suppressions.slice(0, DEFAULT_PROJECTION_AUDIT_SUPPRESSION_LIMIT);
    for (const suppression of suppressions) {
      lines.push(
        `    ${formatAuditField(suppression.side)} ${formatAuditField(suppression.stage)} ${formatAuditField(suppression.reasonCode)} [${formatAuditField(suppression.classification)}]${
          suppression.viaDescendantOf === undefined
            ? ""
            : ` via ${formatAuditField(encodeId(suppression.viaDescendantOf))}`
        }`,
      );
    }
    if (suppressions.length < entry.suppressions.length) {
      lines.push(
        `    ... ${entry.suppressions.length - suppressions.length} more suppressions; rerun with --audit-all`,
      );
    }
  }
  if (entries.length < audit.entries.length) {
    const planPath = formatAuditField(options.planPath ?? "<plan artifact>");
    lines.push(
      `Showing ${entries.length} of ${audit.entries.length} entries. Full audit: ${planPath} → projectionAudit; rerun with --audit-all to print every entry.`,
    );
  }
  return `${lines.join("\n")}\n`;
}

/**
 * The suffix appended to the "Proof passed" line when the desired snapshot
 * carried diagnostics (e.g. a skipped-as-unreadable user-mapping fact) — an
 * honest caveat that a syntactically-clean proof doesn't mean the desired
 * state was fully known (drift parity with the `prove`/`drift` diagnostics
 * fix, PR #338 comment 3603601155). Pure + exported so it's testable without
 * a database, alongside {@link formatProofFailure}. Empty when there's
 * nothing to caveat.
 */
export function formatProofPassCaveat(diagnosticsCount: number): string {
  if (diagnosticsCount === 0) return "";
  return ` (${diagnosticsCount} diagnostic${diagnosticsCount === 1 ? "" : "s"} on the desired snapshot — see above)`;
}

/**
 * A coverage caveat appended to the "Proof passed" line so a passing proof never
 * over-claims "data preservation verified" when it could not actually compare
 * every kept table's content. The proof's `coverage` (see `ProofCoverage`) is
 * honest per-table; this renders the parts a bare success line would hide:
 * count-only tables (schema changed, so only the row count was trusted) and
 * tables not compared at all (recreated/dropped by the plan). Pure + exported so
 * it's testable without a database, alongside {@link formatProofFailure}. Empty
 * when every kept, non-empty table was content-verified (keeps the plain
 * message). Does NOT change ok/exit semantics — reporting honesty only.
 */
export function formatProofPassCoverage(coverage: ProofCoverage): string {
  const contentVerified = coverage.perTable.filter(
    (t) => t.contentMode === "fingerprint",
  );
  const countOnly = coverage.perTable.filter((t) => t.contentMode === "count");
  const notCompared = coverage.tablesSkipped;
  if (countOnly.length === 0 && notCompared.length === 0) return "";
  const sample = (refs: TableRef[]): string => {
    const shown = refs.slice(0, 3).map((t) => rel(t.schema, t.name));
    const extra = refs.length - shown.length;
    return extra > 0
      ? `${shown.join(", ")} (+${extra} more)`
      : shown.join(", ");
  };
  const segments = [`${contentVerified.length} content-verified`];
  if (countOnly.length > 0) {
    segments.push(
      `${countOnly.length} count-only (schema changed): ${sample(countOnly.map((t) => t.table))}`,
    );
  }
  if (notCompared.length > 0) {
    segments.push(
      `${notCompared.length} not compared (recreated/dropped): ${sample(
        notCompared.map((t) => t.table),
      )}`,
    );
  }
  return ` — ${segments.join(", ")}`;
}

export async function cmdProve(args: string[]): Promise<void> {
  let parsed;
  try {
    parsed = parseFlags(args, {
      plan: { type: "value", required: true },
      clone: { type: "value", required: true },
      "desired-snapshot": { type: "value", required: true },
      profile: { type: "value" },
      "strict-audit": { type: "boolean" },
      "audit-all": { type: "boolean" },
    });
  } catch (err) {
    if (err instanceof UsageError) {
      throw new UsageError(
        `${err.message}\nUsage: pgdelta prove --plan <plan.json> --clone <pg-url> --desired-snapshot <file> [--profile ${PROFILE_IDS}] [--strict-audit] [--audit-all]`,
      );
    }
    throw err;
  }

  const { flags } = parsed;
  const planPath = flags["plan"];
  const cloneUrl = flags["clone"];
  const snapshotPath = flags["desired-snapshot"];

  process.stderr.write(
    "WARNING: The --clone database will be mutated and can no longer be used as a source.\n",
  );

  const json = readFileSync(planPath, "utf8");
  const thePlan = parsePlan(json);
  const planAuditStatus =
    thePlan.projectionAudit === undefined ? "unavailable" : "available";
  process.stderr.write(
    formatProjectionAudit(
      thePlan.projectionAudit ?? {
        entries: [],
        summary: { total: 0, suspicious: 0, acknowledged: 0, baseline: 0 },
      },
      {
        auditAll: flags["audit-all"],
        auditStatus: planAuditStatus,
        planPath,
      },
    ),
  );
  const {
    factBase: desiredFb,
    redactSecrets: snapshotRedactSecrets,
    profile: snapshotProfile,
  } = loadSnapshot(snapshotPath);
  // Drift parity (PR #338 comment 3603601155): `drift` already surfaces its
  // snapshot's diagnostics (src/cli/commands/drift.ts) — `prove`'s desired
  // snapshot can carry the same kind (e.g. a skipped-as-unreadable user
  // mapping) and previously went unread. Blocking stays error-severity only:
  // a USER_MAPPING_UNREADABLE warning must NOT become fatal here (declined —
  // see plan.ts's gate for where that variant actually matters); it prints
  // and the proof proceeds, with a caveat appended if it later passes.
  printDiagnostics(desiredFb.diagnostics, { label: "desired snapshot" });
  exitIfBlocking(desiredFb.diagnostics, { action: "prove" });

  // The proof re-extracts the (mutated) clone with the PLAN's redaction mode and
  // compares it to the desired snapshot. If the snapshot was captured with a
  // different mode, FDW/subscription secrets would compare placeholder-vs-real
  // and fail the proof spuriously — and only AFTER the clone is destroyed.
  // Reject a mismatch up front so the operator re-generates a consistent pair
  // instead of getting a false failure (review P2).
  // Both default to redacted (true) when unstamped: a snapshot written before the
  // redactSecrets field existed is a default-redacted extract, so it must still be
  // caught as a mismatch against an --unsafe-show-secrets plan (review P2).
  const planRedactSecrets = thePlan.redactSecrets ?? true;
  const snapRedactSecrets = snapshotRedactSecrets ?? true;
  if (snapRedactSecrets !== planRedactSecrets) {
    throw new UsageError(
      `prove: the desired snapshot's redaction mode (redactSecrets=${snapRedactSecrets}) does not match the plan's (redactSecrets=${planRedactSecrets}). ` +
        `Re-generate both with the same --unsafe-show-secrets setting; a mismatch would compare placeholder-vs-real secrets and fail the proof spuriously.`,
    );
  }

  // The profile MUST match the one used to plan: it supplies the handler-aware
  // re-extractor + baseline so the proof reconstructs the SAME managed view it
  // diffed (otherwise operational children reappear as drift). Default to the
  // plan's stamped profile; reject a contradicting --profile before opening the
  // clone. Policy and capability fall back to the plan artifact inside provePlan.
  // effectiveProfileId throws UsageError on a --profile that contradicts the
  // plan artifact; it propagates to main() (→ message + exit 2).
  const profileId: string | undefined = effectiveProfileId(
    flags["profile"],
    thePlan.profile?.id,
  );

  // The desired snapshot must ALSO have been captured under that profile, or the
  // proof reconstructs a different managed view than it diffed (the re-extract
  // runs different handlers than the snapshot's facts were produced with).
  // Reject a mismatch up front — before the clone is opened/mutated — mirroring
  // the redaction-mode guard above. A `null` stamp = captured raw (reconciled as
  // "raw"); an ABSENT stamp is a pre-stamping legacy snapshot and is exempt.
  const resolvedDeclaredId =
    profileId !== undefined && isProfilePath(profileId)
      ? loadProfile(profileId).id
      : profileId;
  const snapshotDeclaredId = snapshotProfile === null ? "raw" : snapshotProfile;
  if (
    snapshotDeclaredId !== undefined &&
    resolvedDeclaredId !== undefined &&
    snapshotDeclaredId !== resolvedDeclaredId
  ) {
    throw new UsageError(
      `prove: the desired snapshot was captured under profile "${snapshotDeclaredId}", but the plan/prove ` +
        `profile resolves to "${resolvedDeclaredId}". A proof must compare against a snapshot captured with the ` +
        `same profile — re-capture the snapshot with a matching --profile, or prove with the snapshot's profile.`,
    );
  }

  const clone = makePool(cloneUrl);
  try {
    process.stderr.write(
      `Proving plan (${thePlan.actions.length} action(s))...\n`,
    );
    const ctx = await resolveCliProfile(clone.pool, profileId, {
      redactSecrets: planRedactSecrets,
    });
    // The baseline the profile resolves MUST match the plan's, or the proof
    // reconstructs a different managed view than the plan diffed. Fail loud with
    // a precise message (Codex #323 finding 1) — prove never got the old
    // `--baseline` flag, so a baselined plan silently proved a different view.
    reconcileBaselineDigest(
      thePlan.baseline?.digest,
      ctx.baseline?.digest,
      "plan artifact",
    );
    // Re-extract the post-apply clone with the SAME redaction mode the plan used
    // (stamped on the artifact), so the proof compares like-for-like against the
    // desired snapshot — an unredacted (`--unsafe-show-secrets`) plan must not be
    // proven against a default-redacted re-extract. Absent → the extract default.
    const verdict = await provePlan(thePlan, clone.pool, desiredFb, {
      ...ctx.proveOptions,
      reextract: (p) => ctx.extract(p, { redactSecrets: planRedactSecrets }),
      strictAudit: flags["strict-audit"],
    });
    if (verdict.ok) {
      process.stderr.write(
        `Proof passed: state and data preservation verified.` +
          `${formatProofPassCoverage(verdict.coverage)}` +
          `${formatProofPassCaveat(desiredFb.diagnostics.length)}\n`,
      );
    } else {
      process.stderr.write("Proof FAILED.\n");
      process.stderr.write(formatProofFailure(verdict));
      // main() maps CliExit(1) → exit 1; the finally still closes the pool.
      throw new CliExit(1);
    }
  } finally {
    await clone.end();
  }
}
