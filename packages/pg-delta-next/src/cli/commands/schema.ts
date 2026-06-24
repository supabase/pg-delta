/**
 * schema export --source <pg-url> --out-dir <dir> [--layout ordered]
 *   Export the source database as SQL files written to disk.
 *   Maps to old `declarative-export`.
 *
 * schema apply --dir <dir> --shadow <pg-url> --target <pg-url>
 *              [--renames auto|prompt|off] [--force]
 *              [--accept-rename <from>=<to>] (repeatable)
 *   Read .sql files recursively (lexicographic), load into shadow, extract
 *   target, plan, apply.  Maps to old `declarative-apply` / `sync`.
 *
 *   --accept-rename <from>=<to>
 *     Confirm one rename candidate by the encoded stable-ids shown in a prior
 *     --renames prompt run.  Repeatable; each flag names one confirmed rename.
 */
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, dirname, resolve, sep } from "node:path";
import { exportSqlFiles } from "../../frontends/export-sql-files.ts";
import { loadSqlFiles } from "../../frontends/load-sql-files.ts";
import { plan } from "../../plan/plan.ts";
import { resolveView } from "../../policy/policy.ts";
import { apply } from "../../apply/apply.ts";
import { encodeId, parseId, type StableId } from "../../core/stable-id.ts";
import { exitIfBlocking, printDiagnostics } from "../diagnostics.ts";
import { makePool } from "../pool.ts";
import { parseFlags, UsageError } from "../flags.ts";
import { PROFILE_IDS, resolveCliProfile } from "../profile.ts";
import type { RenameMode } from "../../plan/renames.ts";
import type { SqlFile } from "../../frontends/load-sql-files.ts";

/** Recursively collect *.sql files in lexicographic order. */
function collectSqlFiles(dir: string): SqlFile[] {
  const result: SqlFile[] = [];
  const recurse = (current: string): void => {
    const entries = readdirSync(current).sort();
    for (const entry of entries) {
      const full = join(current, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        recurse(full);
      } else if (entry.endsWith(".sql")) {
        result.push({
          name: full.slice(dir.length + 1), // relative path from dir
          sql: readFileSync(full, "utf8"),
        });
      }
    }
  };
  recurse(dir);
  return result;
}

export async function cmdSchemaExport(args: string[]): Promise<void> {
  let parsed;
  try {
    parsed = parseFlags(args, {
      source: { type: "value", required: true },
      "out-dir": { type: "value", required: true },
      layout: { type: "value" },
      profile: { type: "value" },
      "strict-coverage": { type: "boolean" },
      "unsafe-show-secrets": { type: "boolean" },
    });
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(
        `${err.message}\nUsage: pg-delta-next schema export --source <pg-url> --out-dir <dir> ` +
          `[--layout ordered] [--profile ${PROFILE_IDS}] [--strict-coverage] [--unsafe-show-secrets]\n`,
      );
      process.exit(2);
    }
    throw err;
  }

  const { flags } = parsed;
  const sourceUrl = flags["source"];
  const outDir = flags["out-dir"];
  let layout: "by-object" | "ordered" = "by-object";
  if (flags["layout"] !== undefined) {
    const v = flags["layout"];
    if (v !== "by-object" && v !== "ordered") {
      process.stderr.write(
        `--layout must be by-object or ordered (got: ${v})\n`,
      );
      process.exit(2);
    }
    layout = v;
  }

  const src = makePool(sourceUrl);
  try {
    // resolve the profile against the source pool so export sees the SAME
    // handler-aware managed view as the profile-aware DB-to-DB path (review P1).
    const ctx = await resolveCliProfile(src.pool, flags["profile"]);
    process.stderr.write("Extracting...\n");
    const { factBase, diagnostics } = await ctx.extract(src.pool, {
      redactSecrets: !flags["unsafe-show-secrets"],
    });
    printDiagnostics(diagnostics);
    exitIfBlocking(diagnostics, {
      strictCoverage: flags["strict-coverage"],
      action: "export",
    });
    // Export the MANAGED VIEW, not the raw extraction: with a profile
    // (policy/capability/baseline) the exported files must match what
    // `plan --profile` diffs, or policy-hidden schemas/roles and baseline
    // objects would be written into the declarative source and then reappear
    // as drift on `schema apply` (Codex review). For `raw` (no policy) this is
    // an identity projection.
    const view = resolveView(
      factBase,
      ctx.planOptions.policy,
      ctx.planOptions.capability,
      ctx.planOptions.baseline,
    );
    const files = exportSqlFiles(view, { layout });

    const outRoot = resolve(outDir);
    for (const file of files) {
      const full = resolve(outDir, file.name);
      // defense-in-depth (review P2): even with per-segment encoding in
      // exportSqlFiles, never let a database identifier escape the output dir.
      if (full !== outRoot && !full.startsWith(outRoot + sep)) {
        throw new Error(
          `export: refusing to write outside ${outDir}: ${file.name}`,
        );
      }
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, file.sql, "utf8");
    }
    process.stderr.write(
      `Exported ${files.length} file(s) to ${outDir} (layout: ${layout})\n`,
    );
  } finally {
    await src.end();
  }
}

export async function cmdSchemaApply(args: string[]): Promise<void> {
  let parsed;
  try {
    parsed = parseFlags(args, {
      dir: { type: "value", required: true },
      shadow: { type: "value", required: true },
      target: { type: "value", required: true },
      renames: { type: "value" },
      force: { type: "boolean" },
      "accept-rename": { type: "multi" },
      profile: { type: "value" },
      "restrict-to-applier": { type: "boolean" },
      "strict-coverage": { type: "boolean" },
    });
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(
        `${err.message}\nUsage: pg-delta-next schema apply --dir <dir> --shadow <pg-url> --target <pg-url> ` +
          `[--renames auto|prompt|off] [--force] [--accept-rename <from>=<to>] ... ` +
          `[--profile ${PROFILE_IDS}] [--restrict-to-applier] [--strict-coverage]\n`,
      );
      process.exit(2);
    }
    throw err;
  }

  const { flags } = parsed;
  const dir = flags["dir"];
  const shadowUrl = flags["shadow"];
  const targetUrl = flags["target"];
  const force = flags["force"];
  const acceptRenameRaw = flags["accept-rename"];

  // --renames default for CLI is "prompt"
  let renames: RenameMode = "prompt";
  if (flags["renames"] !== undefined) {
    const v = flags["renames"];
    if (v !== "auto" && v !== "prompt" && v !== "off") {
      process.stderr.write(
        `--renames must be auto, prompt, or off (got: ${v})\n`,
      );
      process.exit(2);
    }
    renames = v;
  }

  // parse --accept-rename <from>=<to> entries
  const acceptRenames: Array<{ from: StableId; to: StableId }> = [];
  for (const entry of acceptRenameRaw) {
    const eqIdx = entry.indexOf("=");
    if (eqIdx === -1) {
      process.stderr.write(
        `--accept-rename value must be in <from>=<to> form (got: ${entry})\n`,
      );
      process.exit(2);
    }
    const fromStr = entry.slice(0, eqIdx);
    const toStr = entry.slice(eqIdx + 1);
    try {
      acceptRenames.push({ from: parseId(fromStr), to: parseId(toStr) });
    } catch (e) {
      process.stderr.write(
        `--accept-rename: invalid stable-id in "${entry}": ${e instanceof Error ? e.message : String(e)}\n`,
      );
      process.exit(2);
    }
  }

  const shadow = makePool(shadowUrl);
  const tgt = makePool(targetUrl);
  try {
    // resolve the profile against the TARGET pool (the apply target): this
    // composes handler-aware extraction, policy, baseline, and — with
    // --restrict-to-applier — the applier capability, exactly as the DB-to-DB
    // `plan` command does, so SQL-file apply == DB-to-DB plan (review P1).
    const ctx = await resolveCliProfile(tgt.pool, flags["profile"], {
      restrictToApplier: flags["restrict-to-applier"],
    });

    process.stderr.write("Loading SQL files into shadow...\n");
    const files = collectSqlFiles(dir);
    process.stderr.write(`  ${files.length} file(s) found\n`);
    // the shadow desired state must be projected with the SAME handlers as the
    // target, so pass the profile extractor through to loadSqlFiles.
    const loadResult = await loadSqlFiles(files, shadow.pool, {
      extract: (p, o) => ctx.extract(p, o),
    });
    process.stderr.write(
      `  Shadow loaded: ${loadResult.factBase.facts().length} facts (${loadResult.rounds} round(s))\n`,
    );

    process.stderr.write("Extracting target...\n");
    const targetResult = await ctx.extract(tgt.pool);
    process.stderr.write(
      `  Target: ${targetResult.factBase.facts().length} facts\n`,
    );

    // surface loader + target extraction diagnostics; --strict-coverage refuses
    // to apply while user objects the engine cannot manage exist (finding 2)
    printDiagnostics(loadResult.diagnostics, { label: "shadow" });
    printDiagnostics(targetResult.diagnostics, { label: "target" });
    exitIfBlocking([...loadResult.diagnostics, ...targetResult.diagnostics], {
      strictCoverage: flags["strict-coverage"],
      action: "apply",
    });

    const planOptions = {
      renames,
      ...(acceptRenames.length > 0 ? { acceptRenames } : {}),
      ...ctx.planOptions, // policy, capability, baseline (from the profile)
    };
    const thePlan = plan(
      targetResult.factBase,
      loadResult.factBase,
      planOptions,
    );
    process.stderr.write(`Planning: ${thePlan.actions.length} action(s)\n`);

    // print rename candidates in prompt mode
    if (renames === "prompt" && thePlan.renameCandidates.length > 0) {
      process.stderr.write(`\nRename candidates:\n`);
      for (const c of thePlan.renameCandidates) {
        const fromStr = encodeId(c.from);
        const toStr = encodeId(c.to);
        if (c.status === "unambiguous") {
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
      process.stderr.write("\n");
    }

    if (thePlan.actions.length === 0) {
      process.stderr.write("Target is already up to date.\n");
      return;
    }

    if (force) {
      process.stderr.write("WARNING: --force disables the fingerprint gate.\n");
    }

    const report = await apply(thePlan, tgt.pool, {
      ...ctx.applyOptions, // baseline + handler-aware re-extract (from the profile)
      fingerprintGate: !force,
    });

    if (report.status === "applied") {
      process.stderr.write(
        `Applied ${report.appliedActions} action(s) successfully.\n`,
      );
    } else {
      process.stderr.write("Apply failed!\n");
      if (report.error) {
        process.stderr.write(
          `  action[${report.error.actionIndex}]: ${report.error.message}\n`,
        );
        process.stderr.write(`  sql: ${report.error.sql}\n`);
      }
      process.exit(1);
    }
  } finally {
    await Promise.all([shadow.end(), tgt.end()]);
  }
}
