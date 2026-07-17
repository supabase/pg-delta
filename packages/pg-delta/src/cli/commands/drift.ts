/**
 * drift --env <pg-url> --snapshot <file>
 * Diff the live environment against a saved snapshot.
 * Exit 0 = no drift; exit 1 = drift found.
 * Stage-9 deliverable 7.
 */
import { diff } from "../../core/diff.ts";
import { encodeId } from "../../core/stable-id.ts";
import { loadSnapshot } from "../../frontends/snapshot-file.ts";
import { exitIfBlocking, printDiagnostics } from "../diagnostics.ts";
import { makePool } from "../pool.ts";
import { parseFlags, UsageError } from "../flags.ts";
import { PROFILE_IDS, resolveCliProfile } from "../profile.ts";

export async function cmdDrift(args: string[]): Promise<void> {
  let parsed;
  try {
    parsed = parseFlags(args, {
      env: { type: "value", required: true },
      snapshot: { type: "value", required: true },
      profile: { type: "value" },
      "strict-coverage": { type: "boolean" },
      "unsafe-show-secrets": { type: "boolean" },
    });
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(
        `${err.message}\nUsage: pgdelta drift --env <pg-url> --snapshot <file> [--profile ${PROFILE_IDS}] [--strict-coverage] [--unsafe-show-secrets]\n`,
      );
      process.exit(2);
    }
    throw err;
  }

  const { flags } = parsed;
  const envUrl = flags["env"];
  const snapshotPath = flags["snapshot"];

  const env = makePool(envUrl);
  try {
    const {
      factBase: snapshotFb,
      pgVersion: snapshotPgVersion,
      redactSecrets: snapshotRedactSecrets,
    } = loadSnapshot(snapshotPath);
    process.stderr.write(
      `Snapshot: ${snapshotFb.facts().length} facts (pg ${snapshotPgVersion})\n`,
    );
    // The snapshot side carries its own diagnostics (Codex P2, PR #338) —
    // e.g. a USER_MAPPING_UNREADABLE that plan()'s gate needs, or the
    // pre-existing unmodeled_kind/INTENT_UNKEYED findings from whenever the
    // snapshot was captured. Surfaced with the same labeled + combined-set
    // gating pattern every multi-source command uses (plan.ts, diff.ts):
    // print with a "snapshot" label, then include in the blocking check
    // below alongside the live extraction's diagnostics.
    printDiagnostics(snapshotFb.diagnostics, { label: "snapshot" });

    // Match the snapshot's redaction mode so a snapshot saved with
    // --unsafe-show-secrets is compared against an equally-unredacted live
    // extract (otherwise unchanged FDW/subscription secrets read as
    // placeholder-vs-real drift). Prefer the mode stamped on the snapshot;
    // fall back to the flag for snapshots written before it was recorded.
    const redactSecrets =
      snapshotRedactSecrets ?? !flags["unsafe-show-secrets"];

    // Match the extractor to the snapshot: a snapshot captured with
    // `--profile` carries handler-aware facts (pg_cron intent, pg_partman
    // provenance), so the live re-extract must run the SAME handlers or those
    // facts read as spurious drift. `skipBaseline` — drift is a raw
    // snapshot-vs-live comparison, and the profile may declare a baseline that is
    // irrelevant here (and need not exist).
    const ctx = await resolveCliProfile(env.pool, flags["profile"], {
      redactSecrets,
      skipBaseline: true,
    });

    process.stderr.write("Extracting live environment...\n");
    const {
      factBase: liveFb,
      pgVersion: livePgVersion,
      diagnostics,
    } = await ctx.extract(env.pool, { redactSecrets });
    printDiagnostics(diagnostics);
    // Combined set (snapshot + live), same as every other multi-source
    // command — blocking semantics/exit codes are unchanged: this only
    // widens WHICH diagnostics are considered, not what counts as blocking
    // (hasBlockingDiagnostics still only blocks error severity / the
    // strict-coverage unmodeled_kind case).
    exitIfBlocking([...snapshotFb.diagnostics, ...diagnostics], {
      strictCoverage: flags["strict-coverage"],
      action: "report drift",
    });
    process.stderr.write(
      `Live: ${liveFb.facts().length} facts (pg ${livePgVersion})\n`,
    );

    // diff(snapshot, live): adds = live has extra, removes = live is missing
    const deltas = diff(snapshotFb, liveFb);

    if (deltas.length === 0) {
      process.stdout.write("No drift detected.\n");
      process.exit(0);
    }

    process.stdout.write(`Drift detected: ${deltas.length} delta(s)\n\n`);
    for (const d of deltas) {
      let line: string;
      switch (d.verb) {
        case "add":
          line = `+ ${encodeId(d.fact.id)}`;
          break;
        case "remove":
          line = `- ${encodeId(d.fact.id)}`;
          break;
        case "set":
          line = `~ ${encodeId(d.id)} .${d.attr}`;
          break;
        case "link":
          line = `+ link ${encodeId(d.edge.from)} -> ${encodeId(d.edge.to)}`;
          break;
        case "unlink":
          line = `- link ${encodeId(d.edge.from)} -> ${encodeId(d.edge.to)}`;
          break;
      }
      process.stdout.write(`${line}\n`);
    }
    process.exit(1);
  } finally {
    await env.end();
  }
}
