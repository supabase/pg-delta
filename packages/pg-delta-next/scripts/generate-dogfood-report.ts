#!/usr/bin/env bun
/**
 * Generate an interactive HTML report from a dogfooding run directory.
 *
 * Usage:
 *   bun scripts/generate-dogfood-report.ts --run-dir ../../docs/dogfooding/runs/suite
 *   bun scripts/generate-dogfood-report.ts --run-dir /tmp/dogfood --out /tmp/report.html --open
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildReportPayload } from "./lib/report-core.ts";
import { renderReportHtml } from "./lib/report-template.ts";

function parseArgs(argv: string[]): {
  runDir: string;
  out: string;
  open: boolean;
} {
  let runDir = "";
  let out = "";
  let open = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--run-dir") {
      runDir = argv[++i] ?? "";
    } else if (arg === "--out") {
      out = argv[++i] ?? "";
    } else if (arg === "--open") {
      open = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: bun scripts/generate-dogfood-report.ts --run-dir <path> [--out <file.html>] [--open]

Generate a self-contained HTML review report from dogfooding artifacts.

Options:
  --run-dir <path>   Directory containing scenario subdirs (required)
  --out <path>       Output HTML path (default: <run-dir>/report.html)
  --open             Open the report in the default browser after generation
`);
      process.exit(0);
    }
  }

  if (!runDir) {
    console.error("Error: --run-dir is required\nRun with --help for usage.");
    process.exit(1);
  }

  runDir = resolve(runDir);
  if (!out) out = join(runDir, "report.html");
  else out = resolve(out);

  return { runDir, out, open };
}

async function main(): Promise<void> {
  const { runDir, out, open } = parseArgs(process.argv.slice(2));

  if (!existsSync(runDir)) {
    console.error(`Error: run directory does not exist: ${runDir}`);
    process.exit(1);
  }

  const payload = buildReportPayload(runDir);
  if (payload.scenarios.length === 0) {
    console.error(
      `Error: no scenarios found in ${runDir} (expected subdirs with metrics.json)`,
    );
    process.exit(1);
  }

  const html = renderReportHtml(payload);
  await Bun.write(out, html);
  process.stderr.write(
    `[dogfood:report] ${payload.scenarios.length} scenarios → ${out}\n`,
  );

  if (open) {
    const proc = Bun.spawn(["open", out], {
      stdout: "ignore",
      stderr: "ignore",
    });
    await proc.exited;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
