/**
 * Parity check: locally-built PostgREST (with `openapi-metadata` ON) vs the live
 * DB introspection path, both fed through the same TypeScript generator.
 *
 *   reference: live DB -> introspect()                         -> generateTypescript()
 *   candidate: PostgREST OpenAPI (x-postgrest-typegen-metadata)
 *              -> openApiToGeneratorMetadata()                  -> generateTypescript()
 *
 * Unlike the spike, this drives the PRODUCTION adapter (`src/openapi`) against a
 * PostgREST built from this branch (which emits the metadata block).
 *
 * Requires the `POSTGREST_BIN` env var pointing at the built binary
 * (`cabal list-bin exe:postgrest`). Docker required for Postgres.
 *
 * Run via run-parity.sh (sets POSTGREST_BIN + nix env).
 */
import { execFileSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { Pool } from "pg";

import { generateTypescript } from "../../src/generation/index.ts";
import { introspect } from "../../src/introspection/index.ts";
import { openApiToGeneratorMetadata } from "../../src/openapi/index.ts";
import type { OpenApiDocumentWithMetadata } from "../../src/openapi/types.ts";
import { sortGeneratorMetadata } from "../../src/sort.ts";

const HERE = import.meta.dir;
const FIXTURE_DIR = join(HERE, "..", "..", "test", "introspection", "fixtures");
const NETWORK = "parity-net";
const PG_NAME = "parity-pg";
const PGRST_PORT = 3019;
const POSTGREST_BIN = process.env.POSTGREST_BIN;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const docker = (args: string[], allowFail = false) => {
  try {
    return execFileSync("docker", args, { encoding: "utf8" }).trim();
  } catch (e: any) {
    if (allowFail) return "";
    throw new Error(
      `docker ${args.join(" ")} failed:\n${e.stderr ?? e.message}`,
    );
  }
};
const mappedPort = (name: string, p: number) => {
  const out = docker(["port", name, String(p)]).split("\n")[0] ?? "";
  return Number(out.slice(out.lastIndexOf(":") + 1));
};
const cleanupDocker = () => {
  docker(["rm", "-f", PG_NAME], true);
  docker(["network", "rm", NETWORK], true);
};

async function main() {
  if (!POSTGREST_BIN) throw new Error("POSTGREST_BIN env var is required");

  cleanupDocker();
  docker(["network", "create", NETWORK]);
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

  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      await pool.query("select 1");
      ready = true;
      break;
    } catch {
      await sleep(1000);
    }
  }
  if (!ready) throw new Error("postgres not ready");
  console.log("[parity] postgres ready, applying fixtures…");
  await pool.query(readFileSync(join(FIXTURE_DIR, "00-init.sql"), "utf8"));
  await pool.query(readFileSync(join(FIXTURE_DIR, "01-memes.sql"), "utf8"));
  await pool.query(readFileSync(join(HERE, "roles-seed.sql"), "utf8"));

  // Local PostgREST against the mapped pg port, with the metadata flag ON.
  const confPath = join(HERE, "parity.postgrest.conf");
  writeFileSync(
    confPath,
    [
      `db-uri = "postgres://authenticator:authpass@127.0.0.1:${pgPort}/postgres"`,
      `db-schemas = "public"`,
      `db-anon-role = "anon"`,
      `openapi-mode = "ignore-privileges"`,
      `openapi-metadata = true`,
      `server-port = ${PGRST_PORT}`,
    ].join("\n") + "\n",
  );

  console.log(`[parity] starting postgrest (${POSTGREST_BIN})…`);
  const pgrst = spawn(POSTGREST_BIN, [confPath], { stdio: "inherit" });
  const baseUrl = `http://127.0.0.1:${PGRST_PORT}`;
  try {
    let openapi: OpenApiDocumentWithMetadata | null = null;
    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch(`${baseUrl}/`);
        if (res.ok) {
          const doc = (await res.json()) as OpenApiDocumentWithMetadata;
          const defs = (doc.definitions ?? {}) as Record<string, unknown>;
          if ("users" in defs && "memes" in defs) {
            openapi = doc;
            break;
          }
        }
      } catch {
        /* not up yet */
      }
      await sleep(1000);
    }
    if (!openapi)
      throw new Error("could not fetch OpenAPI from local postgrest");
    writeFileSync(
      join(HERE, "parity.openapi.json"),
      JSON.stringify(openapi, null, 2),
    );
    const hasBlockKey = "x-postgrest-typegen-metadata" in openapi;
    console.log(`[parity] openapi fetched; has metadata block: ${hasBlockKey}`);

    const candidateMeta = openApiToGeneratorMetadata(openapi);
    const candidateTs = await generateTypescript(
      sortGeneratorMetadata(candidateMeta),
    );
    writeFileSync(join(HERE, "parity.candidate.ts"), candidateTs);

    const ref = await introspect(pool, { includedSchemas: ["public"] });
    // Normalize: PostgREST doesn't expose partition children (or other
    // non-API-reachable relations), so restrict the reference to the relation
    // set the candidate exposes before diffing.
    const exposed = new Set(
      [
        ...candidateMeta.tables,
        ...candidateMeta.views,
        ...candidateMeta.foreignTables,
        ...candidateMeta.materializedViews,
      ].map((t) => `${t.schema}.${t.name}`),
    );
    ref.tables = ref.tables.filter((t) => exposed.has(`${t.schema}.${t.name}`));
    ref.views = ref.views.filter((t) => exposed.has(`${t.schema}.${t.name}`));
    ref.foreignTables = ref.foreignTables.filter((t) =>
      exposed.has(`${t.schema}.${t.name}`),
    );
    ref.materializedViews = ref.materializedViews.filter((t) =>
      exposed.has(`${t.schema}.${t.name}`),
    );
    ref.columns = ref.columns.filter((c) =>
      exposed.has(`${c.schema}.${c.table}`),
    );
    const referenceTs = await generateTypescript(sortGeneratorMetadata(ref));
    writeFileSync(join(HERE, "parity.reference.ts"), referenceTs);

    let diff = "";
    try {
      diff = execFileSync(
        "diff",
        [
          "-u",
          join(HERE, "parity.reference.ts"),
          join(HERE, "parity.candidate.ts"),
        ],
        { encoding: "utf8" },
      );
    } catch (e: any) {
      diff = e.stdout ?? "";
    }
    writeFileSync(join(HERE, "parity.diff"), diff || "(identical)\n");
    console.log(`[parity] diff lines: ${diff ? diff.split("\n").length : 0}`);
    console.log(
      `[parity] reference ${referenceTs.length}B, candidate ${candidateTs.length}B`,
    );
  } finally {
    pgrst.kill("SIGTERM");
    await pool.end();
    cleanupDocker();
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    cleanupDocker();
    process.exit(1);
  });
