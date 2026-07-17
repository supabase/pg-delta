/**
 * render --plan <plan.json> --out <base>.sql [--allow-drops]
 *
 * Read a plan artifact and write its SQL as one or more dbmate-friendly
 * `.sql` files, split on the same segment boundaries `apply()` uses at
 * execution time (src/apply/apply.ts::segmentActions). Argv parsing, fs
 * writes, and the stdout summary live here; all rendering logic is in the
 * pure `renderPlan` (../render.ts) so it is unit-testable without fs/process.
 *
 * Exit codes: 0 = files written, 1 = error (no files written), 2 = usage
 * error, 3 = plan has no actions (no files written, not an error).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parsePlan } from "../../plan/artifact.ts";
import { CliExit, parseFlags, UsageError } from "../flags.ts";
import { renderPlan } from "../render.ts";

const USAGE =
  "Usage: pgdelta render --plan <plan.json> --out <base>.sql [--allow-drops]\n";

/** Given "--out" value, split into base + ".sql" ext. Strips a trailing
 *  ".sql" if present; otherwise treats the whole value as the base. */
function splitBase(outPath: string): string {
  return outPath.endsWith(".sql") ? outPath.slice(0, -".sql".length) : outPath;
}

export async function cmdRender(args: string[]): Promise<void> {
  let parsed;
  try {
    parsed = parseFlags(args, {
      plan: { type: "value", required: true },
      out: { type: "value", required: true },
      "allow-drops": { type: "boolean" },
    });
  } catch (err) {
    if (err instanceof UsageError) {
      throw new UsageError(`${err.message}\n${USAGE.trimEnd()}`);
    }
    throw err;
  }

  const { flags } = parsed;
  const planPath = flags["plan"];
  const outPath = flags["out"];
  const allowDrops = flags["allow-drops"];

  const json = readFileSync(planPath, "utf8");
  const thePlan = parsePlan(json);

  let result;
  try {
    result = renderPlan(thePlan, { allowDrops });
  } catch (err) {
    process.stderr.write(
      `Error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    throw new CliExit(1);
  }

  if (!result.changes) {
    process.stderr.write(
      "No changes: plan has no actions. Writing no files.\n",
    );
    process.stdout.write(`${JSON.stringify({ changes: false, files: [] })}\n`);
    throw new CliExit(3);
  }

  const base = splitBase(outPath);
  const writtenFiles: {
    path: string;
    transactional: boolean;
    actionCount: number;
  }[] = [];
  for (const file of result.files) {
    const path = `${base}${file.suffix ?? ""}.sql`;
    writeFileSync(path, file.contents, "utf8");
    writtenFiles.push({
      path,
      transactional: file.transactional,
      actionCount: file.actionCount,
    });
  }

  process.stderr.write(`Wrote ${writtenFiles.length} file(s).\n`);
  process.stdout.write(
    `${JSON.stringify({ changes: true, files: writtenFiles })}\n`,
  );
}
