#!/usr/bin/env bun
/**
 * Run bookmark dogfooding scenarios via testcontainer (avoids broken local supabase config).
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { bootstrapBookmarkFixture } from "./lib/bootstrap-bookmark-fixture.ts";
import { compareEngines } from "./lib/compare-core.ts";
import { resolveRunOutDir } from "./lib/paths.ts";

const REPO_ROOT = new URL("../../../", import.meta.url).pathname;

interface BookmarkArgs {
  outRoot: string;
  prove: boolean;
  applyCheck: boolean;
}

function parseArgs(argv: string[]): BookmarkArgs {
  let outDirArg: string | undefined;
  let prove = false;
  let applyCheck = true;

  for (const arg of argv) {
    switch (arg) {
      case "--prove":
        prove = true;
        break;
      case "--no-apply-check":
        applyCheck = false;
        break;
      default:
        if (arg.startsWith("--")) throw new Error(`Unknown argument: ${arg}`);
        outDirArg = arg;
        break;
    }
  }

  // A relative out-dir is anchored to the repo root, NOT process.cwd(): under
  // `bun run` / foreground / background the cwd differs, which previously made
  // artifacts land in a path that didn't survive the run.
  const outRoot = resolveRunOutDir(
    outDirArg,
    REPO_ROOT,
    join(
      "docs/dogfooding/runs/bookmark",
      new Date().toISOString().replace(/[:.]/g, "-"),
    ),
  );

  return { outRoot, prove, applyCheck };
}

const {
  outRoot: OUT_ROOT,
  prove: PROVE,
  applyCheck: APPLY_CHECK,
} = parseArgs(process.argv.slice(2));

async function main(): Promise<void> {
  mkdirSync(OUT_ROOT, { recursive: true });
  process.stderr.write(`[run-bookmark-dogfood] → ${OUT_ROOT}\n`);

  const fixture = await bootstrapBookmarkFixture();
  const results: Record<string, unknown> = {};

  try {
    // zero-diff
    {
      const outDir = join(OUT_ROOT, "bookmark-zero-diff");
      mkdirSync(outDir, { recursive: true });
      results["bookmark-zero-diff"] = await compareEngines(
        fixture.baselinePool,
        fixture.baselinePool,
        {
          scenario: "bookmark-zero-diff",
          outDir,
          profile: "supabase",
          applyCheck: false,
        },
      );
    }

    // add-column
    {
      const mutated = await fixture.createMutatedDb(
        "ALTER TABLE public.bookmarks ADD COLUMN tags text[];",
      );
      try {
        const outDir = join(OUT_ROOT, "bookmark-add-column");
        mkdirSync(outDir, { recursive: true });
        results["bookmark-add-column"] = await compareEngines(
          fixture.baselinePool,
          mutated.pool,
          {
            scenario: "bookmark-add-column",
            outDir,
            profile: "supabase",
            applyCheck: APPLY_CHECK,
            prove: PROVE,
          },
          fixture.baselineCloneSource,
        );
      } finally {
        await mutated.drop();
      }
    }

    // rls-change — add policy for postgres role (present in managed view)
    {
      const mutated = await fixture.createMutatedDb(`
        CREATE POLICY "Postgres can view all bookmarks"
        ON public.bookmarks
        AS permissive
        FOR SELECT
        TO postgres
        USING (true);
      `);
      try {
        const outDir = join(OUT_ROOT, "bookmark-rls-change");
        mkdirSync(outDir, { recursive: true });
        results["bookmark-rls-change"] = await compareEngines(
          fixture.baselinePool,
          mutated.pool,
          {
            scenario: "bookmark-rls-change",
            outDir,
            profile: "supabase",
            applyCheck: APPLY_CHECK,
            prove: PROVE,
          },
          fixture.baselineCloneSource,
        );
      } finally {
        await mutated.drop();
      }
    }
  } finally {
    await fixture.cleanup();
  }

  const summary = Object.fromEntries(
    Object.entries(results).map(([name, m]) => {
      const metrics = m as {
        old: { statementCount: number; planMs: number };
        new: { statementCount: number; planMs: number };
        applyCheck?: { bucket: string };
      };
      return [
        name,
        {
          oldStatements: metrics.old.statementCount,
          newStatements: metrics.new.statementCount,
          oldPlanMs: metrics.old.planMs,
          newPlanMs: metrics.new.planMs,
          applyBucket: metrics.applyCheck?.bucket ?? "n/a",
        },
      ];
    }),
  );

  process.stderr.write("\n━━━━━━━━ bookmark dogfood summary ━━━━━━━━\n");
  for (const [name, row] of Object.entries(summary)) {
    const r = row as {
      oldStatements: number;
      newStatements: number;
      applyBucket?: string;
    };
    process.stderr.write(
      `  ${name}: old=${r.oldStatements} new=${r.newStatements} apply=${r.applyBucket ?? "n/a"}\n`,
    );
  }
  process.stderr.write("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  await Bun.write(
    join(OUT_ROOT, "bookmark-summary.json"),
    JSON.stringify(summary, null, 2),
  );
}

await main();
