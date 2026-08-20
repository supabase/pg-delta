/**
 * plan --source <pg-url> --desired <pg-url>
 *      [--renames auto|prompt|off] [--no-compact] [--out <plan.json>]
 *      [--accept-rename <from>=<to>] (repeatable)
 *
 * Extract both databases, plan, write serializePlan to --out (default stdout).
 * Print a human summary to stderr: action count, safety report, rename
 * candidates (prompt-mode candidates listed as questions with from/to),
 * filtered-delta count.
 *
 * --accept-rename <from>=<to>
 *   Confirm one rename candidate identified during a prior --renames prompt run.
 *   <from> and <to> are the encoded stable-ids printed in the prompt output
 *   (e.g. table:public.users).  Repeatable; each flag names one confirmed rename.
 *   In prompt mode, accepted renames become real renames; unconfirmed unambiguous
 *   candidates are treated as drop+create.
 */
import { plan } from "../../plan/plan.ts";
import { serializePlan } from "../../plan/artifact.ts";
import { encodeId, parseId, type StableId } from "../../core/stable-id.ts";
import { exitIfBlocking, printDiagnostics } from "../diagnostics.ts";
import { makePool } from "../pool.ts";
import { parseFlags, UsageError } from "../flags.ts";
import { PROFILE_IDS, resolveCliProfile } from "../profile.ts";
import type { RenameMode } from "../../plan/renames.ts";
import { writeFileSync } from "node:fs";
import {
  connectionEndpointHash,
  databaseIdentityObservationUnavailableCode,
  databaseIdentityStamp,
  observeDatabaseIdentity,
  type DatabaseIdentityObservationUnavailableCode,
} from "../connection-safety.ts";

const USAGE =
  "Usage: pgdelta plan --source <pg-url> --desired <pg-url> " +
  `[--profile ${PROFILE_IDS}] ` +
  "[--renames auto|prompt|off] [--no-compact] [--out <plan.json>] " +
  "[--accept-rename <from>=<to>] ... [--restrict-to-applier] [--strict-coverage] " +
  "[--unsafe-show-secrets]\n";

export function formatPlanIdentityWarning(
  code: DatabaseIdentityObservationUnavailableCode,
): string {
  if (code === "42883") {
    return (
      "WARNING: plan could not observe the source PostgreSQL lineage/database identity because " +
      "pg_catalog.pg_control_system() is unavailable on this server. The plan remains applicable, " +
      "but CLI prove will require --allow-unverified-source-identity. To retain verified identity " +
      "checks, re-plan against a PostgreSQL server that provides pg_catalog.pg_control_system().\n"
    );
  }
  return (
    "WARNING: plan could not observe the source PostgreSQL lineage/database identity. " +
    "The plan remains applicable, but CLI prove will require " +
    "--allow-unverified-source-identity. To retain verified identity checks, grant " +
    "EXECUTE on pg_catalog.pg_control_system() to the connection role and re-plan.\n"
  );
}

export async function cmdPlan(args: string[]): Promise<void> {
  let parsed;
  try {
    parsed = parseFlags(args, {
      source: { type: "value", required: true },
      desired: { type: "value", required: true },
      profile: { type: "value" },
      renames: { type: "value" },
      "no-compact": { type: "boolean" },
      out: { type: "value" },
      "accept-rename": { type: "multi" },
      "restrict-to-applier": { type: "boolean" },
      "strict-coverage": { type: "boolean" },
      "unsafe-show-secrets": { type: "boolean" },
    });
  } catch (err) {
    if (err instanceof UsageError) {
      throw new UsageError(`${err.message}\n${USAGE.trimEnd()}`);
    }
    throw err;
  }

  const { flags } = parsed;
  const sourceUrl = flags["source"];
  const desiredUrl = flags["desired"];
  const compact = !flags["no-compact"];
  const outPath = flags["out"];
  const acceptRenameRaw = flags["accept-rename"]; // string[]

  // --renames default for CLI is "prompt"
  let renames: RenameMode = "prompt";
  if (flags["renames"] !== undefined) {
    const v = flags["renames"];
    if (v !== "auto" && v !== "prompt" && v !== "off") {
      throw new UsageError(
        `--renames must be auto, prompt, or off (got: ${v})`,
      );
    }
    renames = v;
  }

  // parse --accept-rename <from>=<to> entries
  const acceptRenames: Array<{ from: StableId; to: StableId }> = [];
  for (const entry of acceptRenameRaw) {
    const eqIdx = entry.indexOf("=");
    if (eqIdx === -1) {
      throw new UsageError(
        `--accept-rename value must be in <from>=<to> form (got: ${entry})`,
      );
    }
    const fromStr = entry.slice(0, eqIdx);
    const toStr = entry.slice(eqIdx + 1);
    try {
      acceptRenames.push({ from: parseId(fromStr), to: parseId(toStr) });
    } catch (e) {
      throw new UsageError(
        `--accept-rename: invalid stable-id in "${entry}": ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  const src = makePool(sourceUrl, { role: "source" });
  const dst = makePool(desiredUrl);
  try {
    // redaction mode is passed into profile resolution so a profile-declared
    // baseline captured in the OTHER mode is rejected (its secret-bearing facts
    // would hash differently and silently stop subtracting).
    const redactSecrets = !flags["unsafe-show-secrets"];
    // Resolve the profile against the SOURCE pool (the source is the apply
    // target): this composes handler-aware extraction, the profile's policy +
    // baseline, and — with --restrict-to-applier — the applier capability. All
    // three flow into planOptions so plan == prove == apply (P0/P2).
    const ctx = await resolveCliProfile(src.pool, flags["profile"], {
      restrictToApplier: flags["restrict-to-applier"],
      redactSecrets,
    });

    process.stderr.write("Extracting source...\n");
    process.stderr.write("Extracting desired...\n");
    const [sourceResult, desiredResult] = await Promise.all([
      ctx.extract(src.pool, { redactSecrets }),
      ctx.extract(dst.pool, { redactSecrets }),
    ]);
    let sourceIdentity;
    try {
      sourceIdentity = databaseIdentityStamp(
        await observeDatabaseIdentity(src.pool),
      );
    } catch (error) {
      const code = databaseIdentityObservationUnavailableCode(error);
      if (code === undefined) throw error;
      process.stderr.write(formatPlanIdentityWarning(code));
    }

    // surface extraction diagnostics (review finding 2); --strict-coverage
    // refuses to plan while user objects the engine cannot manage exist
    printDiagnostics(sourceResult.diagnostics, { label: "source" });
    printDiagnostics(desiredResult.diagnostics, { label: "desired" });
    exitIfBlocking(
      [...sourceResult.diagnostics, ...desiredResult.diagnostics],
      {
        strictCoverage: flags["strict-coverage"],
        action: "plan",
      },
    );

    const planOptions = {
      renames,
      compact,
      // stamp the redaction mode on the artifact so apply/prove re-extract the
      // target identically for the fingerprint gate (an unsafe plan fingerprinted
      // over unredacted secrets must not be gated against a redacted re-extract).
      redactSecrets,
      ...(acceptRenames.length > 0 ? { acceptRenames } : {}),
      ...ctx.planOptions, // policy, capability, baseline (from the profile)
    };
    const thePlan = plan(
      sourceResult.factBase,
      desiredResult.factBase,
      planOptions,
    );
    printDiagnostics(thePlan.diagnostics ?? [], { label: "plan" });
    exitIfBlocking(thePlan.diagnostics ?? [], {
      strictCoverage: flags["strict-coverage"],
      action: "plan",
    });
    // Credential-free origin stamp: prove uses this only to reject the most
    // dangerous endpoint mixup (`--clone` accidentally receives SOURCE_URL).
    thePlan.source.endpointHash = connectionEndpointHash(sourceUrl);
    if (sourceIdentity !== undefined) {
      thePlan.source.identity = sourceIdentity;
    }

    // human summary → stderr
    process.stderr.write(`\nPlan summary:\n`);
    process.stderr.write(`  actions:          ${thePlan.actions.length}\n`);
    process.stderr.write(
      `  filtered deltas:  ${thePlan.filteredDeltas.length}\n`,
    );
    process.stderr.write(
      `  destructive:      ${thePlan.safetyReport.destructiveActions}\n`,
    );
    process.stderr.write(
      `  rewrite risk:     ${thePlan.safetyReport.rewriteRiskActions}\n`,
    );
    process.stderr.write(
      `  non-transactional:${thePlan.safetyReport.nonTransactionalActions}\n`,
    );

    if (thePlan.renameCandidates.length > 0) {
      process.stderr.write(`\nRename candidates:\n`);
      for (const c of thePlan.renameCandidates) {
        const fromStr = encodeId(c.from);
        const toStr = encodeId(c.to);
        if (renames === "prompt" && c.status === "unambiguous") {
          process.stderr.write(
            `  ? Rename ${fromStr} -> ${toStr}? (${c.status})\n`,
          );
          process.stderr.write(
            `    To confirm, rerun with: --accept-rename ${fromStr}=${toStr}\n`,
          );
        } else {
          process.stderr.write(
            `  ${c.status}: ${fromStr} -> ${toStr}${c.reason ? ` (${c.reason})` : ""}\n`,
          );
        }
      }
    }

    const json = serializePlan(thePlan);

    if (outPath) {
      writeFileSync(outPath, json, "utf8");
      process.stderr.write(`\nPlan written to ${outPath}\n`);
    } else {
      process.stdout.write(json + "\n");
    }
  } finally {
    await Promise.all([src.end(), dst.end()]);
  }
}
