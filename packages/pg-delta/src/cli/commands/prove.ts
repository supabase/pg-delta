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
import { loadSnapshot } from "../../frontends/snapshot-file.ts";
import { encodeId } from "../../core/stable-id.ts";
import { exitIfBlocking, printDiagnostics } from "../diagnostics.ts";
import { makePool } from "../pool.ts";
import {
  connectionEndpointHash,
  isTrustedLocalConnection,
} from "../connection-safety.ts";
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
  if (verdict.sourceStateViolation !== undefined) {
    lines.push(
      `  clone state mismatch: expected ${verdict.sourceStateViolation.expectedFingerprint.slice(0, 12)}… ` +
        `but observed ${verdict.sourceStateViolation.actualFingerprint.slice(0, 12)}…; the clone was not mutated`,
    );
  }
  if (verdict.desiredStateViolation !== undefined) {
    lines.push(
      `  desired snapshot mismatch: expected ${verdict.desiredStateViolation.expectedFingerprint.slice(0, 12)}… ` +
        `but observed ${verdict.desiredStateViolation.actualFingerprint.slice(0, 12)}…; the clone was not mutated`,
    );
  }
  if ((verdict.safetyMetadataViolations?.length ?? 0) > 0) {
    lines.push(
      `  undeclared table destruction (${verdict.safetyMetadataViolations!.length}):`,
    );
    for (const violation of verdict.safetyMetadataViolations!) {
      lines.push(
        `    action[${violation.actionIndex}] destroys ${rel(violation.table.schema, violation.table.name)} but declares dataLoss:none`,
      );
    }
  }
  if (verdict.applyError) {
    lines.push(
      `  apply error at action[${verdict.applyError.actionIndex}]: ${verdict.applyError.message}`,
    );
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

export function assertProofCloneEndpoint(
  cloneUrl: string,
  sourceEndpointHash: string | undefined,
  trustedLocalHosts: readonly string[],
  allowRemoteClone: boolean,
): void {
  let cloneEndpointHash: string;
  let local: boolean;
  try {
    cloneEndpointHash = connectionEndpointHash(cloneUrl);
    local = isTrustedLocalConnection(cloneUrl, trustedLocalHosts);
  } catch (error) {
    throw new UsageError(
      `prove: invalid clone endpoint safety option — ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (
    sourceEndpointHash !== undefined &&
    cloneEndpointHash === sourceEndpointHash
  ) {
    throw new UsageError(
      "prove: the clone resolves to the plan's source endpoint; refusing to mutate the original source database",
    );
  }
  if (!local && !allowRemoteClone) {
    throw new UsageError(
      "prove: --clone must use localhost, a loopback address, a Unix socket, or an exact --trusted-local-host; pass --allow-remote-clone only for an intentional remote disposable clone",
    );
  }
}

export async function cmdProve(args: string[]): Promise<void> {
  let parsed;
  try {
    parsed = parseFlags(args, {
      plan: { type: "value", required: true },
      clone: { type: "value", required: true },
      "desired-snapshot": { type: "value", required: true },
      profile: { type: "value" },
      "trusted-local-host": { type: "multi" },
      "allow-remote-clone": { type: "boolean" },
    });
  } catch (err) {
    if (err instanceof UsageError) {
      throw new UsageError(
        `${err.message}\nUsage: pgdelta prove --plan <plan.json> --clone <pg-url> --desired-snapshot <file> [--profile ${PROFILE_IDS}] ` +
          `[--trusted-local-host <hostname>]... [--allow-remote-clone]`,
      );
    }
    throw err;
  }

  const { flags } = parsed;
  const planPath = flags["plan"];
  const cloneUrl = flags["clone"];
  const snapshotPath = flags["desired-snapshot"];

  const json = readFileSync(planPath, "utf8");
  const thePlan = parsePlan(json);
  assertProofCloneEndpoint(
    cloneUrl,
    thePlan.source.endpointHash,
    flags["trusted-local-host"],
    flags["allow-remote-clone"],
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

  process.stderr.write(
    "WARNING: prove may mutate the --clone database; use only a disposable clone.\n",
  );
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
