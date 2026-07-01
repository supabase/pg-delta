/**
 * prove --plan <plan.json> --clone <pg-url> --desired-snapshot <file>
 *
 * Run the proof loop against a sacrificial clone of the source.
 * WARNING: the clone is mutated and will no longer reflect the source.
 */
import { readFileSync } from "node:fs";
import { parsePlan } from "../../plan/artifact.ts";
import { rel } from "../../plan/render.ts";
import { provePlan, type ProofVerdict } from "../../proof/prove.ts";
import { loadSnapshot } from "../../frontends/snapshot-file.ts";
import { encodeId } from "../../core/stable-id.ts";
import { makePool } from "../pool.ts";
import { parseFlags, UsageError } from "../flags.ts";
import {
  effectiveProfileId,
  PROFILE_IDS,
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

export async function cmdProve(args: string[]): Promise<void> {
  let parsed;
  try {
    parsed = parseFlags(args, {
      plan: { type: "value", required: true },
      clone: { type: "value", required: true },
      "desired-snapshot": { type: "value", required: true },
      profile: { type: "value" },
    });
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(
        `${err.message}\nUsage: pg-delta-next prove --plan <plan.json> --clone <pg-url> --desired-snapshot <file> [--profile ${PROFILE_IDS}]\n`,
      );
      process.exit(2);
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
  const { factBase: desiredFb, redactSecrets: snapshotRedactSecrets } =
    loadSnapshot(snapshotPath);

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
    process.stderr.write(
      `prove: the desired snapshot's redaction mode (redactSecrets=${snapRedactSecrets}) does not match the plan's (redactSecrets=${planRedactSecrets}). ` +
        `Re-generate both with the same --unsafe-show-secrets setting; a mismatch would compare placeholder-vs-real secrets and fail the proof spuriously.\n`,
    );
    process.exit(2);
  }

  // The profile MUST match the one used to plan: it supplies the handler-aware
  // re-extractor + baseline so the proof reconstructs the SAME managed view it
  // diffed (otherwise operational children reappear as drift). Default to the
  // plan's stamped profile; reject a contradicting --profile before opening the
  // clone. Policy and capability fall back to the plan artifact inside provePlan.
  let profileId: string | undefined;
  try {
    profileId = effectiveProfileId(flags["profile"], thePlan.profile?.id);
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(2);
    }
    throw err;
  }

  const clone = makePool(cloneUrl);
  try {
    process.stderr.write(
      `Proving plan (${thePlan.actions.length} action(s))...\n`,
    );
    const ctx = await resolveCliProfile(clone.pool, profileId);
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
        "Proof passed: state and data preservation verified.\n",
      );
    } else {
      process.stderr.write("Proof FAILED.\n");
      process.stderr.write(formatProofFailure(verdict));
      process.exit(1);
    }
  } finally {
    await clone.end();
  }
}
