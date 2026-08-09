/**
 * diff --source <pg-url> --desired <pg-url>
 * Print a delta summary grouped by verb and kind.
 */
import { diff } from "../../core/diff.ts";
import { encodeId } from "../../core/stable-id.ts";
import { resolveView } from "../../policy/policy.ts";
import { exitIfBlocking, printDiagnostics } from "../diagnostics.ts";
import { makePool } from "../pool.ts";
import { parseFlags, UsageError } from "../flags.ts";
import { PROFILE_IDS, resolveCliProfile } from "../profile.ts";
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
      profile: { type: "value" },
      "strict-coverage": { type: "boolean" },
      "unsafe-show-secrets": { type: "boolean" },
    });
  } catch (err) {
    if (err instanceof UsageError) {
      throw new UsageError(
        `${err.message}\nUsage: pgdelta diff --source <pg-url> --desired <pg-url> [--profile ${PROFILE_IDS}] [--strict-coverage] [--unsafe-show-secrets]`,
      );
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
    // Resolve the profile against the source: handler-aware extraction + the
    // policy / capability / baseline that define the managed view, so a
    // profile-declared baseline's platform objects are subtracted and not shown
    // as ordinary differences (raw when --profile is omitted).
    const ctx = await resolveCliProfile(src.pool, flags["profile"], {
      redactSecrets,
    });
    process.stderr.write("Extracting source...\n");
    const [sourceResult, desiredResult] = await Promise.all([
      ctx.extract(src.pool, { redactSecrets }),
      ctx.extract(dst.pool, { redactSecrets }),
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

    // project BOTH sides through the managed view (policy scope + baseline
    // subtraction + capability) so the diff reflects only what the profile
    // manages — same lens the DB-to-DB `plan` uses. For the raw profile this is
    // an identity projection, so the default `diff` is unchanged.
    const projected = (fb: typeof sourceResult.factBase) =>
      resolveView(
        fb,
        ctx.planOptions.policy,
        ctx.planOptions.capability,
        ctx.planOptions.baseline,
      );
    const deltas = diff(
      projected(sourceResult.factBase),
      projected(desiredResult.factBase),
    );

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
