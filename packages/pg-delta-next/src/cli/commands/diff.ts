/**
 * diff --source <pg-url> --desired <pg-url>
 * Print a delta summary grouped by verb and kind.
 */
import { diff } from "../../core/diff.ts";
import { encodeId } from "../../core/stable-id.ts";
import { extract } from "../../extract/extract.ts";
import { exitIfBlocking, printDiagnostics } from "../diagnostics.ts";
import { makePool } from "../pool.ts";
import { parseFlags, UsageError } from "../flags.ts";
import type { Delta } from "../../core/diff.ts";

function subjectKind(d: Delta): string {
  switch (d.verb) {
    case "add":
    case "remove":
      return d.fact.id.kind;
    case "set":
      return d.id.kind;
    case "link":
    case "unlink":
      return d.edge.from.kind;
  }
}

function subjectId(d: Delta): string {
  switch (d.verb) {
    case "add":
    case "remove":
      return encodeId(d.fact.id);
    case "set":
      return encodeId(d.id);
    case "link":
    case "unlink":
      return encodeId(d.edge.from);
  }
}

export async function cmdDiff(args: string[]): Promise<void> {
  let parsed;
  try {
    parsed = parseFlags(args, {
      source: { type: "value", required: true },
      desired: { type: "value", required: true },
      "strict-coverage": { type: "boolean" },
      "unsafe-show-secrets": { type: "boolean" },
    });
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(
        `${err.message}\nUsage: pg-delta-next diff --source <pg-url> --desired <pg-url> [--strict-coverage] [--unsafe-show-secrets]\n`,
      );
      process.exit(2);
    }
    throw err;
  }

  const { flags } = parsed;
  const sourceUrl = flags["source"];
  const desiredUrl = flags["desired"];
  const redactSecrets = !flags["unsafe-show-secrets"];

  const src = makePool(sourceUrl);
  const dst = makePool(desiredUrl);
  try {
    process.stderr.write("Extracting source...\n");
    const [sourceResult, desiredResult] = await Promise.all([
      extract(src.pool, { redactSecrets }),
      extract(dst.pool, { redactSecrets }),
    ]);
    process.stderr.write("Extracting desired...\n");

    printDiagnostics(sourceResult.diagnostics, { label: "source" });
    printDiagnostics(desiredResult.diagnostics, { label: "desired" });
    exitIfBlocking(
      [...sourceResult.diagnostics, ...desiredResult.diagnostics],
      {
        strictCoverage: flags["strict-coverage"],
        action: "diff",
      },
    );

    const deltas = diff(sourceResult.factBase, desiredResult.factBase);

    if (deltas.length === 0) {
      process.stdout.write("No differences found.\n");
      return;
    }

    // group by verb then kind
    const grouped = new Map<string, Map<string, string[]>>();
    for (const d of deltas) {
      const verb = d.verb;
      const kind = subjectKind(d);
      const id = subjectId(d);
      if (!grouped.has(verb)) grouped.set(verb, new Map());
      const byKind = grouped.get(verb)!;
      if (!byKind.has(kind)) byKind.set(kind, []);
      byKind.get(kind)!.push(id);
    }

    for (const [verb, byKind] of grouped) {
      process.stdout.write(`\n${verb.toUpperCase()}\n`);
      for (const [kind, ids] of byKind) {
        process.stdout.write(`  ${kind} (${ids.length})\n`);
        for (const id of ids) {
          process.stdout.write(`    ${id}\n`);
        }
      }
    }
    process.stdout.write(`\nTotal: ${deltas.length} delta(s)\n`);
  } finally {
    await Promise.all([src.end(), dst.end()]);
  }
}
