#!/usr/bin/env bun
/**
 * Reclaim leaked testcontainers.
 *
 * testcontainers' Ryuk reaper normally removes a run's containers when the test
 * process dies. Gaps still happen — the Docker daemon restarts (orphaning what
 * Ryuk was tracking), Ryuk is disabled, or a run is killed before Ryuk connects
 * — and the shared cluster singletons in tests/containers.ts are never stopped
 * explicitly. This script reclaims those orphans.
 *
 * It targets ONLY containers carrying the `org.testcontainers=true` label, and
 * is age-guarded: by default it removes only those older than --min-age minutes
 * (default 60), so a run in flight is never touched. Run it anytime, or as a CI
 * post-step.
 *
 *   bun run docker:clean                  # remove testcontainers older than 60m
 *   bun run docker:clean --min-age 30     # ...older than 30m
 *   bun run docker:clean --all            # remove ALL testcontainers (no tests running!)
 *   bun run docker:clean --dry-run        # show what would be removed, remove nothing
 *
 * Keep Ryuk ENABLED (do not set TESTCONTAINERS_RYUK_DISABLED) — this script is a
 * backstop, not a replacement for it.
 */

interface Row {
  id: string;
  image: string;
  runningFor: string;
  names: string;
}

const LABEL = "org.testcontainers=true";

function parseArgs(argv: string[]): {
  minAgeMin: number;
  all: boolean;
  dryRun: boolean;
} {
  let minAgeMin = 60;
  let all = false;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") all = true;
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--min-age") minAgeMin = Number(argv[++i] ?? "60");
  }
  return { minAgeMin, all, dryRun };
}

/** docker is spawned directly here (not via a shell), so it is unaffected by
 *  any shell command-rewriting; `--filter`/`--format` work as upstream docker. */
async function docker(args: string[]): Promise<string> {
  const proc = Bun.spawn(["docker", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, code] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    const err = await new Response(proc.stderr).text();
    throw new Error(`docker ${args.join(" ")} failed: ${err.trim()}`);
  }
  return out;
}

/** "Up 42 hours" / "10 minutes ago" → is this older than the threshold? Recent
 *  (seconds/minutes) is never reclaimed unless --all. */
function isOlderThan(runningFor: string, minAgeMin: number): boolean {
  if (/second|minute/.test(runningFor)) {
    const m = /(\d+)\s+minute/.exec(runningFor);
    return m ? Number(m[1]) >= minAgeMin : false;
  }
  // hours / days / weeks → always older than any minute threshold
  return /hour|day|week|month/.test(runningFor);
}

async function main(): Promise<void> {
  const { minAgeMin, all, dryRun } = parseArgs(Bun.argv.slice(2));

  const raw = await docker([
    "ps",
    "-a",
    "--filter",
    `label=${LABEL}`,
    "--format",
    "{{.ID}}|{{.Image}}|{{.RunningFor}}|{{.Names}}",
  ]);
  const rows: Row[] = raw
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => {
      const [id, image, runningFor, names] = l.split("|");
      return { id, image, runningFor, names } as Row;
    });

  if (rows.length === 0) {
    console.log("No testcontainers found. Nothing to reclaim.");
    return;
  }

  const victims = all
    ? rows
    : rows.filter((r) => isOlderThan(r.runningFor, minAgeMin));
  const kept = rows.length - victims.length;

  console.log(
    `${rows.length} testcontainer(s); ${victims.length} to remove, ${kept} kept` +
      (all ? " (--all)" : ` (older than ${minAgeMin}m)`) +
      (dryRun ? " [dry-run]" : ""),
  );
  for (const v of victims) {
    console.log(
      `  ${dryRun ? "would remove" : "removing"}: ${v.names}  (${v.image}, ${v.runningFor})`,
    );
  }
  if (dryRun || victims.length === 0) return;

  await docker(["rm", "-f", ...victims.map((v) => v.id)]);
  console.log(`Removed ${victims.length} container(s).`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
