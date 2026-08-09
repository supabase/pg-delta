/**
 * Supabase baseline snapshot generator (stage-08-policy).
 *
 * Connects to a database URL, extracts its fact base, and saves a snapshot
 * to src/policy/baselines/supabase-<pgmajor>.json.
 *
 * USAGE
 *   bun run scripts/generate-supabase-baseline.ts <db-url> [<pg-major>]
 *
 *   <db-url>    PostgreSQL connection URL
 *                 e.g. postgres://postgres:postgres@localhost:54322/postgres
 *   <pg-major>  Optional override for the PostgreSQL major version (e.g. 17).
 *               If omitted, detected automatically via SHOW server_version.
 *
 * WHEN TO RUN
 *   Run against a FRESH (just-started, user-schema-empty) supabase/postgres
 *   container. The snapshot captures platform-managed facts so they can be
 *   subtracted from user-DB extracts before diffing — replacing the old
 *   emptyCatalog mechanism.
 *
 *   Example workflow:
 *     docker run -d --name supa-base \
 *       -e POSTGRES_PASSWORD=postgres \
 *       -p 54322:5432 \
 *       supabase/postgres:15.8.1.106
 *     docker exec supa-base /usr/bin/pg_bootstrap.sh   # Supabase bootstrap
 *     bun run scripts/generate-supabase-baseline.ts \
 *       postgres://supabase_admin:postgres@localhost:54322/postgres 15
 *     docker stop supa-base && docker rm supa-base
 *
 * REGENERATE WHEN
 *   The supabase/postgres image tag pinned in tests/constants.ts changes.
 *   After regenerating, run the focused regression tests to verify no
 *   phantom deltas appear on a freshly bootstrapped Supabase DB.
 *
 * NOTE: Do NOT run this script in CI directly — it requires a running Supabase
 * container and produces a committed artifact. Regenerate locally and commit.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { extract } from "../src/extract/extract.ts";
import { serializeSnapshot } from "../src/core/snapshot.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const dbUrl = process.argv[2];
  if (!dbUrl) {
    console.error(
      "Usage: bun run scripts/generate-supabase-baseline.ts <db-url> [<pg-major>]",
    );
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: dbUrl, max: 3 });
  pool.on("error", () => {});

  try {
    console.log(`Connecting to ${dbUrl} ...`);

    // Detect pg major version (from argv or via SHOW server_version)
    let pgMajor: number;
    if (process.argv[3] !== undefined) {
      pgMajor = parseInt(process.argv[3] as string, 10);
      if (Number.isNaN(pgMajor) || pgMajor < 14) {
        console.error(
          `Invalid pg-major argument: ${process.argv[3]}. Must be an integer >= 14.`,
        );
        process.exit(1);
      }
    } else {
      const res = await pool.query(
        `SELECT current_setting('server_version_num')::int AS v`,
      );
      const vnum = (res.rows[0] as { v: number }).v;
      pgMajor = Math.floor(vnum / 10000);
      console.log(`Detected PostgreSQL major version: ${pgMajor}`);
    }

    console.log("Extracting fact base ...");
    const { factBase, pgVersion } = await extract(pool);
    console.log(
      `Extracted ${factBase.facts().length} facts, ${factBase.edges.length} edges.`,
    );
    console.log(`Fact base root hash: ${factBase.rootHash}`);

    const json = serializeSnapshot(factBase, { pgVersion });

    const outDir = resolve(__dirname, "../src/policy/baselines");
    await mkdir(outDir, { recursive: true });

    const outPath = join(outDir, `supabase-${pgMajor}.json`);
    await writeFile(outPath, json, "utf-8");
    console.log(`Baseline saved to: ${outPath}`);
  } finally {
    await pool.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
