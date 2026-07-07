#!/usr/bin/env bun
/**
 * pg-delta-next CLI v2 — thin consumer of the public API.
 * Zero new dependencies; manual argv parsing; exits 1 on failure, 2 on
 * usage errors.
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  Old → New command mapping (old commands from pg-delta/src/cli/)    │
 * ├──────────────────────────┬──────────────────────────────────────────┤
 * │  plan                    │  plan                                    │
 * │  apply                   │  apply                                   │
 * │  sync                    │  plan + apply  (or: schema apply)        │
 * │  catalog-export          │  snapshot                                │
 * │  declarative-apply       │  schema apply                            │
 * │  declarative-export      │  schema export                           │
 * └──────────────────────────┴──────────────────────────────────────────┘
 *
 * Commands:
 *   plan           --source <pg-url> --desired <pg-url>
 *                  [--renames auto|prompt|off] [--no-compact] [--out <plan.json>]
 *                  [--accept-rename <from>=<to>] ...
 *   apply          --plan <plan.json> --target <pg-url> [--force]
 *   render         --plan <plan.json> --out <base>.sql [--allow-drops]
 *   prove          --plan <plan.json> --clone <pg-url> --desired-snapshot <file>
 *   diff           --source <pg-url> --desired <pg-url>
 *   drift          --env <pg-url> --snapshot <file>
 *   snapshot       --source <pg-url> --out <file>
 *   schema export  --source <pg-url> --out-dir <dir> [--layout by-object|ordered|grouped]
 *   schema apply   --dir <dir> --shadow <pg-url> --target <pg-url>
 *                  [--renames auto|prompt|off] [--force]
 *                  [--accept-rename <from>=<to>] ... [--no-reorder]
 *   schema lint    --dir <dir>
 *                  Statically check the SQL files (pg-topo) for shadow-load
 *                  cycles and other issues, without touching a database.
 *
 * --renames default for the CLI is "prompt" (the library default is "off").
 * --accept-rename <from>=<to>
 *   Confirm one rename candidate using the encoded stable-ids printed during a
 *   prior --renames prompt run (e.g. --accept-rename table:public.old=table:public.new).
 *   Repeatable; each occurrence confirms one rename.  Available on: plan, schema apply.
 */

import { cmdPlan } from "./commands/plan.ts";
import { cmdApply } from "./commands/apply.ts";
import { cmdRender } from "./commands/render.ts";
import { cmdProve } from "./commands/prove.ts";
import { cmdDiff } from "./commands/diff.ts";
import { cmdDrift } from "./commands/drift.ts";
import { cmdSnapshot } from "./commands/snapshot.ts";
import {
  cmdSchemaExport,
  cmdSchemaApply,
  cmdSchemaLint,
} from "./commands/schema.ts";

const USAGE = `
pg-delta-next <command> [options]

Commands:
  plan           --source <pg-url> --desired <pg-url>
                 [--renames auto|prompt|off] [--no-compact] [--out <plan.json>]
                 [--accept-rename <from>=<to>] ...
  apply          --plan <plan.json> --target <pg-url> [--force]
  render         --plan <plan.json> --out <base>.sql [--allow-drops]
  prove          --plan <plan.json> --clone <pg-url> --desired-snapshot <file>
  diff           --source <pg-url> --desired <pg-url>
  drift          --env <pg-url> --snapshot <file>
  snapshot       --source <pg-url> --out <file>
  schema export  --source <pg-url> --out-dir <dir> [--layout by-object|ordered|grouped]
                 [--format-options <json>]   (pretty-print SQL; any layout)
                 grouped adds: [--grouping-mode single-file|subdirectory]
                 [--group-patterns <json>] [--flat-schemas <csv>] [--no-group-partitions]
  schema apply   --dir <dir> --shadow <pg-url> --target <pg-url>
                 [--renames auto|prompt|off] [--force]
                 [--accept-rename <from>=<to>] ... [--no-reorder]
  schema lint    --dir <dir>

Notes:
  --profile: raw | supabase, OR a path to a custom profile .json file
    (a value containing "/" or ending in ".json" is loaded from disk). The
    file is { "id": ..., "handlers": ["pg_partman", "pg_cron"], "policy"?: {…} },
    referencing bundled handlers by name. Available on plan / diff / drift /
    snapshot / apply / prove / schema export / schema apply.
  render: writes the plan's SQL as one .sql file per executor segment,
    split on the same boundaries "apply" uses at execution time. A single
    segment writes <base>.sql; multiple segments write <base>_1.sql,
    <base>_2.sql, ... in execution order. A non-transactional segment's file
    starts with a machine-readable "-- pg-delta: transaction=false" header.
    render is migration-runner-agnostic: it emits ordered segment SQL and
    leaves runner-specific packaging to a thin consumer. For dbmate, that
    consumer writes one migration per segment with a DISTINCT version, wraps
    each in -- migrate:up / -- migrate:down, and maps the transactionality
    header to "-- migrate:up transaction:false". Refuses to render a
    DESTRUCTIVE plan unless --allow-drops is given — any "drop"-verb action
    OR any action marked dataLoss:"destructive" (e.g. an enum rewrite), per
    the plan's safety metadata, not the verb alone.
    Exit codes: 0 = files written, 1 = error (no files written),
    2 = usage error, 3 = plan has no actions (no files written, not an
    error). Prints one JSON summary line to stdout; human/status output
    goes to stderr only.
  --renames defaults to "prompt" for the CLI (library default is "off").
  --accept-rename: confirm a rename from a prior prompt run; repeatable.
  --no-reorder (schema apply): skip the statement-reordering assist and load
    raw files at file granularity. Reorder is on by default — it splits files
    into one-statement units and topologically pre-sorts them so authoring
    order within a file no longer matters.
  --unsafe-show-secrets (plan, diff, drift, snapshot, schema export, schema apply):
    emit REAL foreign-data option values and subscription conninfo instead of
    redacted placeholders. Off by default; raises a loud warning when set.
    Only for output destined for a trusted target. An unredacted plan stamps its
    redaction mode on the artifact; "apply" and "prove" re-extract the target with
    that same mode, so the fingerprint gate passes without "--force". Snapshots
    likewise record their mode so "drift" re-extracts identically.

Old → New mapping:
  plan              -> plan
  apply             -> apply
  sync              -> plan + apply  (or: schema apply)
  catalog-export    -> snapshot
  declarative-apply -> schema apply
  declarative-export-> schema export
`.trimStart();

async function main(): Promise<void> {
  // Bun populates process.argv as: ["bun", "main.ts", ...userArgs]
  const args = process.argv.slice(2);
  const command = args[0];
  const rest = args.slice(1);

  try {
    switch (command) {
      case "plan":
        await cmdPlan(rest);
        break;
      case "apply":
        await cmdApply(rest);
        break;
      case "render":
        await cmdRender(rest);
        break;
      case "prove":
        await cmdProve(rest);
        break;
      case "diff":
        await cmdDiff(rest);
        break;
      case "drift":
        await cmdDrift(rest);
        break;
      case "snapshot":
        await cmdSnapshot(rest);
        break;
      case "schema": {
        const sub = rest[0];
        const subArgs = rest.slice(1);
        if (sub === "export") {
          await cmdSchemaExport(subArgs);
        } else if (sub === "apply") {
          await cmdSchemaApply(subArgs);
        } else if (sub === "lint") {
          await cmdSchemaLint(subArgs);
        } else {
          process.stderr.write(
            `Unknown schema subcommand: ${sub ?? "(none)"}\n` +
              "Available: export, apply, lint\n",
          );
          process.exit(2);
        }
        break;
      }
      case "--help":
      case "-h":
      case "help":
        process.stdout.write(USAGE);
        break;
      default:
        process.stderr.write(
          `Unknown command: ${command ?? "(none)"}\n\n${USAGE}`,
        );
        process.exit(2);
    }
  } catch (error) {
    process.stderr.write(
      `Error: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }
}

void main();
