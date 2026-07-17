/**
 * snapshot --source <pg-url> --out <file> [--profile <id|path>]
 * Extract from the source database and write a snapshot file.
 * Replaces the old `catalog-export` command.
 *
 * `--profile` uses the profile's handler-aware extractor, so a snapshot intended
 * as a baseline captures the SAME facts (extension-intent rows like pg_cron jobs,
 * `managedBy` edges) that a profile-aware plan/export/apply extraction produces —
 * otherwise those handler facts would never hash-match and the baseline would not
 * subtract them. A profile's policy/baseline projection is deliberately NOT
 * applied: a baseline is the raw handler-aware capture, not a managed view.
 *
 * Baseline resolution is SKIPPED (`skipBaseline`): a profile that declares a
 * `"baseline"` is very often being used to CAPTURE that very file, so requiring
 * it to already exist would be a chicken-and-egg — the first capture (or a
 * regeneration after the file is deleted / the base image changes) must not fail
 * loading a baseline it is about to write.
 */
import { saveSnapshot } from "../../frontends/snapshot-file.ts";
import { exitIfBlocking, printDiagnostics } from "../diagnostics.ts";
import { makePool } from "../pool.ts";
import { parseFlags, UsageError } from "../flags.ts";
import { PROFILE_IDS, resolveCliProfile } from "../profile.ts";

export async function cmdSnapshot(args: string[]): Promise<void> {
  let parsed;
  try {
    parsed = parseFlags(args, {
      source: { type: "value", required: true },
      out: { type: "value", required: true },
      profile: { type: "value" },
      "strict-coverage": { type: "boolean" },
      "unsafe-show-secrets": { type: "boolean" },
    });
  } catch (err) {
    if (err instanceof UsageError) {
      throw new UsageError(
        `${err.message}\nUsage: pgdelta snapshot --source <pg-url> --out <file> [--profile ${PROFILE_IDS}] [--strict-coverage] [--unsafe-show-secrets]`,
      );
    }
    throw err;
  }

  const { flags } = parsed;
  const sourceUrl = flags["source"];
  const outPath = flags["out"];
  const redactSecrets = !flags["unsafe-show-secrets"];

  const src = makePool(sourceUrl);
  try {
    // handler-aware extraction (profile handlers only); no policy/baseline
    // projection — a baseline snapshot is the raw capture. skipBaseline avoids
    // the chicken-and-egg of a profile that declares the baseline this very
    // command is capturing.
    const ctx = await resolveCliProfile(src.pool, flags["profile"], {
      redactSecrets,
      skipBaseline: true,
    });
    process.stderr.write("Extracting...\n");
    const { factBase, pgVersion, diagnostics } = await ctx.extract(src.pool, {
      redactSecrets,
    });
    printDiagnostics(diagnostics);
    exitIfBlocking(diagnostics, {
      strictCoverage: flags["strict-coverage"],
      action: "snapshot",
    });
    // record the redaction mode so `drift` re-extracts the live env identically.
    saveSnapshot(factBase, pgVersion, outPath, redactSecrets);
    process.stderr.write(
      `Snapshot saved to ${outPath} (${factBase.facts().length} facts, pg ${pgVersion})\n`,
    );
  } finally {
    await src.end();
  }
}
