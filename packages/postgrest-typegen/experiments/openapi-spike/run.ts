/**
 * SPIKE harness: compare type generation from a live DB vs from a PostgREST
 * OpenAPI document.
 *
 *   reference path:  live DB -> introspect()            -> generateTypescript()
 *   candidate path:  PostgREST OpenAPI -> spike adapter -> generateTypescript()
 *
 * Both paths feed the SAME pure generator, so any difference is attributable to
 * the producer. The harness writes artifacts next to this file and a unified
 * diff; REPORT.md (written separately) buckets the differences.
 *
 * Containers are driven through the `docker` CLI directly rather than via
 * testcontainers: under Bun the testcontainers lifecycle promise did not hand
 * control back after the health-check wait completed. The CLI path is fully
 * synchronous and deterministic, which is all a throwaway spike needs.
 *
 * Run: `cd packages/postgrest-typegen && bun experiments/openapi-spike/run.ts`
 *
 * Throwaway experimental code — not wired into the package build/exports, no
 * changeset.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { Pool } from "pg";

import { generateTypescript } from "../../src/generation/index.ts";
import { introspect } from "../../src/introspection/index.ts";
import { parseGeneratorMetadata } from "../../src/types.ts";
import { openApiToGeneratorMetadata, type OpenApiDocument } from "./adapter.ts";

const HERE = import.meta.dir;
const FIXTURE_DIR = join(HERE, "..", "..", "test", "introspection", "fixtures");

const NETWORK = "spike-net";
const PG_NAME = "spike-pg";
const PGRST_NAME = "spike-pgrst";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function docker(args: string[], opts: { allowFail?: boolean } = {}): string {
  try {
    return execFileSync("docker", args, { encoding: "utf8" }).trim();
  } catch (e: any) {
    if (opts.allowFail) return "";
    throw new Error(
      `docker ${args.join(" ")} failed:\n${e.stderr ?? e.message}`,
    );
  }
}

/** `docker port <name> <containerPort>` -> host port number. */
function mappedPort(name: string, containerPort: number): number {
  const out = docker(["port", name, String(containerPort)]);
  // e.g. "0.0.0.0:55001\n[::]:55001" — take the first line's trailing number.
  const first = out.split("\n")[0]?.trim() ?? "";
  const port = Number(first.slice(first.lastIndexOf(":") + 1));
  if (!Number.isFinite(port))
    throw new Error(`could not parse port from: ${out}`);
  return port;
}

function cleanup() {
  docker(["rm", "-f", PG_NAME, PGRST_NAME], { allowFail: true });
  docker(["network", "rm", NETWORK], { allowFail: true });
}

async function main() {
  cleanup(); // remove any leftovers from a previous run

  docker(["network", "create", NETWORK]);
  console.log("[spike] created docker network");

  console.log("[spike] starting postgres:15-alpine …");
  docker([
    "run",
    "-d",
    "--name",
    PG_NAME,
    "--network",
    NETWORK,
    "-e",
    "POSTGRES_USER=postgres",
    "-e",
    "POSTGRES_PASSWORD=postgres",
    "-e",
    "POSTGRES_DB=postgres",
    "-p",
    "127.0.0.1::5432",
    "postgres:15-alpine",
  ]);
  const pgPort = mappedPort(PG_NAME, 5432);
  const pool = new Pool({
    connectionString: `postgres://postgres:postgres@127.0.0.1:${pgPort}/postgres`,
  });

  // Wait for Postgres to accept connections.
  let connected = false;
  for (let i = 0; i < 60; i++) {
    try {
      await pool.query("select 1");
      connected = true;
      break;
    } catch {
      await sleep(1000);
    }
  }
  if (!connected)
    throw new Error("[spike] postgres did not become ready in 60s");
  console.log("[spike] postgres ready");

  console.log("[spike] applying fixtures + roles seed …");
  await pool.query(readFileSync(join(FIXTURE_DIR, "00-init.sql"), "utf8"));
  await pool.query(readFileSync(join(FIXTURE_DIR, "01-memes.sql"), "utf8"));
  await pool.query(readFileSync(join(HERE, "roles-seed.sql"), "utf8"));

  console.log("[spike] starting postgrest/postgrest …");
  docker([
    "run",
    "-d",
    "--name",
    PGRST_NAME,
    "--network",
    NETWORK,
    "-e",
    `PGRST_DB_URI=postgres://authenticator:authpass@${PG_NAME}:5432/postgres`,
    "-e",
    "PGRST_DB_SCHEMAS=public",
    "-e",
    "PGRST_DB_ANON_ROLE=anon",
    // Emit the full API surface regardless of the anon role's privileges.
    "-e",
    "PGRST_OPENAPI_MODE=ignore-privileges",
    "-e",
    "PGRST_LOG_LEVEL=info",
    "-p",
    "127.0.0.1::3000",
    "postgrest/postgrest",
  ]);
  const pgrstPort = mappedPort(PGRST_NAME, 3000);
  const baseUrl = `http://127.0.0.1:${pgrstPort}`;
  console.log(`[spike] postgrest listening at ${baseUrl}`);

  // Schema-cache reload + poll: PostgREST builds its cache at boot (the schema
  // is already in place above), but issue an explicit reload and poll the root
  // OpenAPI endpoint until the expected definitions appear, to avoid any race.
  // https://docs.postgrest.org/en/stable/references/schema_cache.html
  await pool.query(`NOTIFY pgrst, 'reload schema'`);

  let openapi: OpenApiDocument | null = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const res = await fetch(`${baseUrl}/`);
      if (res.ok) {
        const doc = (await res.json()) as OpenApiDocument;
        const defs = doc.definitions ?? {};
        if ("users" in defs && "memes" in defs) {
          openapi = doc;
          break;
        }
      }
    } catch {
      // postgrest not ready yet
    }
    await sleep(1000);
  }

  if (!openapi) {
    throw new Error(
      "[spike] could not obtain an OpenAPI doc with the expected definitions after 40s",
    );
  }
  writeFileSync(join(HERE, "openapi.json"), JSON.stringify(openapi, null, 2));
  console.log(
    `[spike] saved openapi.json (${Object.keys(openapi.definitions ?? {}).length} definitions, ${
      Object.keys(openapi.paths ?? {}).filter((p) => p.startsWith("/rpc/"))
        .length
    } rpc paths)`,
  );

  // --- reference path -------------------------------------------------------
  console.log("[spike] reference path: introspect -> generateTypescript …");
  const ref = await introspect(pool, { includedSchemas: ["public"] });
  const referenceTs = await generateTypescript(ref);
  writeFileSync(join(HERE, "reference.ts"), referenceTs);

  // --- candidate path -------------------------------------------------------
  console.log(
    "[spike] candidate path: openapi adapter -> generateTypescript …",
  );
  const candidateMeta = openApiToGeneratorMetadata(openapi);
  try {
    parseGeneratorMetadata(candidateMeta);
    console.log("[spike] candidate metadata passed parseGeneratorMetadata()");
  } catch (err) {
    console.warn(
      "[spike] candidate metadata FAILED shape validation:",
      String(err),
    );
  }
  const candidateTs = await generateTypescript(candidateMeta);
  writeFileSync(join(HERE, "candidate.ts"), candidateTs);

  // --- diff -----------------------------------------------------------------
  let diff = "";
  try {
    diff = execFileSync(
      "diff",
      ["-u", join(HERE, "reference.ts"), join(HERE, "candidate.ts")],
      { encoding: "utf8" },
    );
  } catch (e: any) {
    diff = e.stdout ?? ""; // diff exits 1 when files differ
  }
  writeFileSync(join(HERE, "output.diff"), diff || "(identical)\n");

  // --- quick stats ----------------------------------------------------------
  const stats = {
    reference: {
      tables: ref.tables.length,
      foreignTables: ref.foreignTables.length,
      views: ref.views.length,
      materializedViews: ref.materializedViews.length,
      columns: ref.columns.length,
      relationships: ref.relationships.length,
      functions: ref.functions.length,
      types: ref.types.length,
    },
    candidate: {
      tables: candidateMeta.tables.length,
      foreignTables: candidateMeta.foreignTables.length,
      views: candidateMeta.views.length,
      materializedViews: candidateMeta.materializedViews.length,
      columns: candidateMeta.columns.length,
      relationships: candidateMeta.relationships.length,
      functions: candidateMeta.functions.length,
      types: candidateMeta.types.length,
    },
    diffLines: diff ? diff.split("\n").length : 0,
    referenceTsBytes: referenceTs.length,
    candidateTsBytes: candidateTs.length,
  };
  writeFileSync(join(HERE, "stats.json"), JSON.stringify(stats, null, 2));
  console.log("[spike] stats:", JSON.stringify(stats, null, 2));

  await pool.end();
  console.log("[spike] done. artifacts written to", HERE);
}

main()
  .then(() => {
    cleanup();
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    cleanup();
    process.exit(1);
  });
