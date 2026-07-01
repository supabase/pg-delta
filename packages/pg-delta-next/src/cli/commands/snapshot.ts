/**
 * snapshot --source <pg-url> --out <file>
 * Extract from the source database and write a snapshot file.
 * Replaces the old `catalog-export` command.
 */
import { extract } from "../../extract/extract.ts";
import { saveSnapshot } from "../../frontends/snapshot-file.ts";
import { exitIfBlocking, printDiagnostics } from "../diagnostics.ts";
import { makePool } from "../pool.ts";
import { parseFlags, UsageError } from "../flags.ts";

export async function cmdSnapshot(args: string[]): Promise<void> {
  let parsed;
  try {
    parsed = parseFlags(args, {
      source: { type: "value", required: true },
      out: { type: "value", required: true },
      "strict-coverage": { type: "boolean" },
      "unsafe-show-secrets": { type: "boolean" },
    });
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(
        `${err.message}\nUsage: pg-delta-next snapshot --source <pg-url> --out <file> [--strict-coverage] [--unsafe-show-secrets]\n`,
      );
      process.exit(2);
    }
    throw err;
  }

  const { flags } = parsed;
  const sourceUrl = flags["source"];
  const outPath = flags["out"];
  const redactSecrets = !flags["unsafe-show-secrets"];

  const src = makePool(sourceUrl);
  try {
    process.stderr.write("Extracting...\n");
    const { factBase, pgVersion, diagnostics } = await extract(src.pool, {
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
