#!/usr/bin/env node
/**
 * pgdelta CLI — thin consumer of the public API.
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
 *   prove          --plan <plan.json> --clone <pg-url> --desired-snapshot <file> [--strict-audit] [--audit-all]
 *   diff           --source <pg-url> --desired <pg-url>
 *   drift          --env <pg-url> --snapshot <file>
 *   snapshot       --source <pg-url> --out <file>
 *   schema export  --source <pg-url> --out-dir <dir> [--layout by-object|ordered|grouped]
 *   schema apply   --dir <dir> [--shadow <pg-url>] --target <pg-url>
 *                  [--renames auto|prompt|off] [--force]
 *                  [--accept-rename <from>=<to>] ... [--no-reorder]
 *                  [--dry-run] [--verbose] [--out-plan <plan.json>]
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

import { readFileSync } from "node:fs";
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
import { CliExit, UsageError } from "./flags.ts";
import { SchemaFrontendError } from "../frontends/index.ts";

const USAGE = `
pgdelta <command> [options]

Commands:
  plan           --source <pg-url> --desired <pg-url>
                 [--renames auto|prompt|off] [--no-compact] [--out <plan.json>]
                 [--accept-rename <from>=<to>] ...
  apply          --plan <plan.json> --target <pg-url> [--force] [--allow-data-loss]
  render         --plan <plan.json> --out <base>.sql [--allow-drops]
  prove          --plan <plan.json> --clone <pg-url> --desired-snapshot <file>
                 [--strict-audit] [--audit-all]
                 [--trusted-local-host <hostname>]... [--allow-remote-clone]
                 [--allow-unverified-source-identity]
  diff           --source <pg-url> --desired <pg-url>
  drift          --env <pg-url> --snapshot <file>
  snapshot       --source <pg-url> --out <file>
  schema export  --source <pg-url> --out-dir <dir> [--layout by-object|ordered|grouped]
                 [--format-options <json>]   (pretty-print SQL; any layout)
                 grouped adds: [--grouping-mode single-file|subdirectory]
                 [--group-patterns <json>] [--flat-schemas <csv>] [--no-group-partitions]
  schema apply   --dir <dir> [--shadow <pg-url>] --target <pg-url>
                 [--renames auto|prompt|off] [--force] [--allow-data-loss]
                 [--scope database|cluster] [--isolated-shadow] [--strict-data-statements]
                 [--trusted-local-host <hostname>]... [--allow-remote-shadow]
                 [--allow-same-database-identity]
                 [--accept-rename <from>=<to>] ... [--no-reorder]
                 [--dry-run] [--verbose] [--out-plan <plan.json>]
  schema lint    --dir <dir>

Notes:
  --profile: raw | supabase, OR a path to a custom profile .json file
    (a value containing "/" or ending in ".json" is loaded from disk). The
    file is { "id": ..., "handlers": ["pg_partman", "pg_cron", "pgmq"],
    "policy"?: {…},
    "baseline"?: "./middleware-base.json" }, referencing bundled handlers by
    name. Available on plan / diff / drift / snapshot / apply / prove /
    schema export / schema apply.
    A profile's "baseline" is a "pgdelta snapshot" file (path resolved relative
    to the profile file) subtracted from both sides before diffing, so
    platform-provided objects (base-image roles, extension-owned schemas)
    captured in it are invisible to the managed view — no policy or per-command
    flag needed. Its digest is stamped on plan artifacts / export manifests and
    reconciled at apply/prove time, so a swapped/edited/missing baseline fails
    loud (plan == prove == apply). Capture one with 'snapshot --profile <same>'
    so it carries the same handler-aware facts. A baseline captured in a
    different --unsafe-show-secrets mode than the command's is rejected.
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
  Safety: prove accepts local clone endpoints by default. Add an exact custom
    hostname with --trusted-local-host, or explicitly opt into a disposable
    remote clone with --allow-remote-clone. CLI plans stamp an opaque PostgreSQL
    lineage/database identity; prove rejects the original database and, for
    cluster-scoped plans, its lineage. Physical/base-backup clones are unsupported.
    Legacy/direct-library plans need --allow-unverified-source-identity; that flag
    never overrides a confirmed identity match. Explicit schema shadows follow
    the same endpoint and identity rules via --allow-remote-shadow. Clone and
    explicit-shadow URLs must stay pinned to one database and physical lineage;
    multi-cluster transaction/load-balancing endpoints are unsupported.
    --allow-same-database-identity (schema apply): proceed when an explicit
    --shadow observes the SAME database identity as the target. A physically
    restored shadow (warm shadow cache rehydrated from a PGDATA snapshot of the
    target cluster) inherits the target's system identifier and database OIDs,
    so it is indistinguishable from the target here; supply this only when the
    shadow is known to be a separate server. Bypassing is reported as a WARNING.
    apply/schema apply refuse actions marked
    dataLoss:"destructive" unless --allow-data-loss is supplied; --force only
    skips the source fingerprint gate and never implies data-loss approval.
  --no-reorder (schema apply): skip the statement-reordering assist and load
    raw files at file granularity. Reorder is on by default — it splits files
    into one-statement units and topologically pre-sorts them so authoring
    order within a file no longer matters.
  --strict-data-statements (schema apply): fail (instead of warn) when
    declarative files leave rows in managed user tables. By default a
    populated table observed after loading is either exempt (pre-existing
    rows in --isolated-shadow mode, reported on the result) or downgraded to
    a "data_statement" warning diagnostic, and the load proceeds with a
    schema-only plan; this flag restores the fatal error (recommended for
    CI).
  schema apply: the applied statements are planner-rendered atomic DDL, not
    the authored declarative SQL (the planner re-derives them from the
    catalog diff between the shadow and target states). --verbose shows every
    statement actually executed on the target connection, including
    transaction framing and session SETs; --dry-run prints the same
    successful-path statements and transaction framing, split on the same
    segment boundaries, without applying them.
  --dry-run (schema apply): plan as usual, then print a portable apply script
    to stdout instead of applying — no fingerprint gate runs, nothing is
    applied. Execute it statement by statement on one session, stopping on the
    first error, with autocommit outside its explicit BEGIN/COMMIT blocks. Do
    not submit it as one multi-statement request or wrap it in one global
    transaction. Safe psql execution behavior:
      psql -X -v ON_ERROR_STOP=1 -f apply.sql
    Supply the connection through secure libpq configuration, environment,
    service, or passfile settings rather than a password-bearing URI in argv.
    A stderr summary reports the action count and flags destructive actions.
    Composes with --out-plan; --verbose has no effect under --dry-run (nothing
    executes, so there is no trace).
  --verbose (schema apply): during the real apply, stream a segment/action
    progress trace to stderr — segment start/end (with outcome), every
    planner-rendered action (the SQL about to run and whether it succeeded,
    with timing), and every other statement sent on the same connection
    (BEGIN, preamble SET/SET LOCAL, COMMIT, ROLLBACK, RESET ALL), prefixed
    "  ; " to stay distinct from action lines. Purely additive: never changes
    what gets applied or the final report.
  --out-plan <plan.json> (schema apply): write the plan artifact (same format
    as "plan --out") to this path right after planning, before apply (or the
    --dry-run script).
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

const SCHEMA_USAGE = `
pgdelta schema <subcommand> [options]

Subcommands:
  schema export  --source <pg-url> --out-dir <dir> [--layout by-object|ordered|grouped]
                 [--format-options <json>]   (pretty-print SQL; any layout)
                 grouped adds: [--grouping-mode single-file|subdirectory]
                 [--group-patterns <json>] [--flat-schemas <csv>] [--no-group-partitions]
  schema apply   --dir <dir> [--shadow <pg-url>] --target <pg-url>
                 [--renames auto|prompt|off] [--force] [--allow-data-loss]
                 [--scope database|cluster] [--isolated-shadow] [--strict-data-statements]
                 [--trusted-local-host <hostname>]... [--allow-remote-shadow]
                 [--allow-same-database-identity]
                 [--accept-rename <from>=<to>] ... [--no-reorder]
                 [--dry-run] [--verbose] [--out-plan <plan.json>]
  schema lint    --dir <dir>
                 Statically check the SQL files (pg-topo) for shadow-load
                 cycles and other issues, without touching a database.

Run 'pgdelta --help' for the full command reference and shared flags.
`.trimStart();

/** Package version, read from the bundled package.json at runtime. */
function readVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

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
        } else if (sub === "--help" || sub === "-h" || sub === "help") {
          process.stdout.write(SCHEMA_USAGE);
        } else {
          process.stderr.write(
            `Unknown schema subcommand: ${sub ?? "(none)"}\n` +
              "Available: export, apply, lint\n",
          );
          process.exit(2);
        }
        break;
      }
      case "--version":
      case "-v":
      case "version":
        process.stdout.write(`${readVersion()}\n`);
        break;
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
    // Command handlers never call process.exit themselves — main is the sole
    // exiter. An operation-result exit arrives as CliExit (the command already
    // wrote its own output); a usage/frontend error arrives as UsageError /
    // SchemaFrontendError and maps to exit 2 with its message. Everything else
    // is an unexpected failure → the generic "Error:" path + exit 1.
    if (error instanceof CliExit) {
      process.exit(error.code);
    }
    if (error instanceof UsageError || error instanceof SchemaFrontendError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(2);
    }
    process.stderr.write(
      `Error: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    // Duck-type check: ShadowLoadError (and any similarly-shaped error) carries
    // per-item `details` (Diagnostic[]) that named the actual failures — surface
    // them instead of leaving the operator with only the summary line.
    const details = (error as { details?: unknown } | null | undefined)
      ?.details;
    if (Array.isArray(details)) {
      for (const detail of details) {
        if (
          detail !== null &&
          typeof detail === "object" &&
          typeof (detail as { code?: unknown }).code === "string" &&
          typeof (detail as { message?: unknown }).message === "string"
        ) {
          process.stderr.write(
            `  - ${(detail as { code: string; message: string }).code}: ${(detail as { code: string; message: string }).message}\n`,
          );
        }
      }
    }
    process.exit(1);
  }
}

void main();
