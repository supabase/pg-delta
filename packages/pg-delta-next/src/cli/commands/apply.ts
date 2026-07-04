/**
 * apply --plan <plan.json> --target <pg-url> [--force]
 *
 * Parse the plan artifact and apply it to the target database.
 * --force disables the fingerprint gate.
 * On failure, print the per-action failure report.
 */
import { readFileSync } from "node:fs";
import { parsePlan } from "../../plan/artifact.ts";
import { apply } from "../../apply/apply.ts";
import { makePool } from "../pool.ts";
import { parseFlags, UsageError } from "../flags.ts";
import {
  effectiveProfileId,
  PROFILE_IDS,
  resolveCliProfile,
} from "../profile.ts";

export async function cmdApply(args: string[]): Promise<void> {
  let parsed;
  try {
    parsed = parseFlags(args, {
      plan: { type: "value", required: true },
      target: { type: "value", required: true },
      profile: { type: "value" },
      force: { type: "boolean" },
    });
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(
        `${err.message}\nUsage: pg-delta-next apply --plan <plan.json> --target <pg-url> [--profile ${PROFILE_IDS}] [--force]\n`,
      );
      process.exit(2);
    }
    throw err;
  }

  const { flags } = parsed;
  const planPath = flags["plan"];
  const targetUrl = flags["target"];
  const force = flags["force"];

  const json = readFileSync(planPath, "utf8");
  const thePlan = parsePlan(json);

  // The profile MUST match the one used to plan: it supplies the handler-aware
  // re-extractor + baseline the fingerprint gate needs to reconstruct the same
  // managed view (otherwise operational children on the target read as drift).
  // Default to the profile stamped on the plan artifact; reject a contradicting
  // --profile up front (before opening a connection) rather than failing
  // indirectly through the gate.
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

  const tgt = makePool(targetUrl);
  try {
    if (force) {
      process.stderr.write(
        "WARNING: --force disables the fingerprint gate. Applying without state verification.\n",
      );
    }
    const ctx = await resolveCliProfile(tgt.pool, profileId);
    process.stderr.write(`Applying ${thePlan.actions.length} action(s)...\n`);

    // Reconstruct the fingerprint with the SAME redaction mode the plan used
    // (stamped on the artifact). Without this, an `--unsafe-show-secrets` plan
    // fingerprinted over unredacted secrets is gated against a default-redacted
    // re-extract and aborts unless `--force`. Absent on direct library plans →
    // the extract default (redacted), matching the profile's default reextract.
    const redactSecrets = thePlan.redactSecrets ?? true;

    const report = await apply(thePlan, tgt.pool, {
      fingerprintGate: !force,
      ...ctx.applyOptions, // reextract (handler-aware) + baseline
      reextract: (p) => ctx.extract(p, { redactSecrets }),
    });

    if (report.status === "applied") {
      process.stderr.write(
        `Applied ${report.appliedActions} action(s) successfully.\n`,
      );
    } else {
      process.stderr.write(`Apply failed!\n`);
      if (report.error) {
        process.stderr.write(
          `  action[${report.error.actionIndex}]: ${report.error.message}\n`,
        );
        process.stderr.write(`  sql: ${report.error.sql}\n`);
      }
      const applied = report.actionStatuses.filter(
        (s) => s === "applied",
      ).length;
      const unapplied = report.actionStatuses.filter(
        (s) => s === "unapplied",
      ).length;
      const inDoubt = report.actionStatuses.filter(
        (s) => s === "inDoubt",
      ).length;
      process.stderr.write(
        `  applied: ${applied}  unapplied: ${unapplied}  inDoubt: ${inDoubt}\n`,
      );
      process.exit(1);
    }
  } finally {
    await tgt.end();
  }
}
