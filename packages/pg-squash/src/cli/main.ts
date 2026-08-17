#!/usr/bin/env node
import { join } from "node:path";
import { Pool } from "pg";
import { readChain } from "../ingest/index.ts";
import {
  maintenanceConnectionString,
  openClusterHandle,
} from "../shadow/index.ts";
import { squash } from "../squash.ts";
import type { ClusterHandle } from "../model/index.ts";
import { publishSquashOutput } from "./publish.ts";

const USAGE = `pgsquash squash <migrations-dir> --out <dir> [--cluster <pg-url>] [--baseline <db>] [--image <docker-image>] [--wrap-transactions]

Compress an ordered migration chain into the minimum number of transactions
and write a proven equivalent chain to --out.

By default output is verbatim user SQL plus per-statement provenance
comments. Pass --wrap-transactions to wrap packed files in BEGIN/COMMIT
(needed only when applying without a per-file transaction runner).

The library never boots Docker. The CLI may start a throwaway Postgres
container when --cluster is omitted (requires testcontainers + Docker).
`;

const fail = (message: string, code: number): never => {
  console.error(message);
  process.exit(code);
};

const parseArgs = (
  argv: string[],
): {
  dir: string;
  out: string;
  cluster?: string;
  baseline: string;
  image: string;
  wrapTransactions: boolean;
} => {
  const positionals: string[] = [];
  let out: string | undefined;
  let cluster: string | undefined;
  let baseline = "template0";
  let image = process.env["PGDELTA_TEST_IMAGE"] ?? "postgres:17-alpine";
  let wrapTransactions = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === "--out") {
      out = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--cluster") {
      cluster = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--baseline") {
      baseline = argv[i + 1] ?? baseline;
      i += 1;
      continue;
    }
    if (arg === "--image") {
      image = argv[i + 1] ?? image;
      i += 1;
      continue;
    }
    if (arg === "--wrap-transactions") {
      wrapTransactions = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(USAGE);
      process.exit(0);
    }
    if (arg.startsWith("-")) {
      fail(`unknown flag ${arg}\n${USAGE}`, 2);
    }
    positionals.push(arg);
  }
  const dir = positionals[1];
  const outDir = out;
  if (positionals[0] !== "squash") return fail(USAGE, 2);
  if (dir === undefined) return fail(USAGE, 2);
  if (outDir === undefined) return fail(USAGE, 2);
  return { dir, out: outDir, cluster, baseline, image, wrapTransactions };
};

const handleFromUrl = async (
  url: string,
  baseline: string,
): Promise<{
  handle: ClusterHandle;
  close: () => Promise<void>;
}> => {
  const admin = new Pool({
    connectionString: maintenanceConnectionString(url, baseline),
    max: 3,
  });
  admin.on("error", () => {});
  const connectionStringFor = (database: string): string => {
    const parsed = new URL(url);
    parsed.pathname = `/${database}`;
    return parsed.toString();
  };
  const handle = await openClusterHandle({ admin, connectionStringFor });
  return {
    handle,
    close: async () => {
      await admin.end().catch(() => {});
    },
  };
};

const handleFromDocker = async (
  image: string,
  baseline: string,
): Promise<{ handle: ClusterHandle; close: () => Promise<void> }> => {
  const { GenericContainer, Wait } = await import("testcontainers");
  const container = await new GenericContainer(image)
    .withEnvironment({
      POSTGRES_USER: "test",
      POSTGRES_PASSWORD: "test",
      POSTGRES_DB: "postgres",
    })
    .withCommand(["postgres", "-c", "fsync=off", "-c", "full_page_writes=off"])
    .withExposedPorts(5432)
    .withWaitStrategy(
      Wait.forLogMessage(/database system is ready to accept connections/, 2),
    )
    .start();
  const url = `postgres://test:test@${container.getHost()}:${container.getMappedPort(5432)}/postgres`;
  const opened = await handleFromUrl(url, baseline);
  return {
    handle: opened.handle,
    close: async () => {
      await opened.close();
      await container.stop().catch(() => {});
    },
  };
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  const chain = await readChain(args.dir);
  if (chain.length === 0) {
    fail(`no timestamp-prefixed .sql files in ${args.dir}`, 1);
  }
  const opened =
    args.cluster !== undefined
      ? await handleFromUrl(args.cluster, args.baseline)
      : await handleFromDocker(args.image, args.baseline).catch(
          (error: unknown) =>
            fail(
              `--cluster is required when a throwaway Postgres container cannot start (${error instanceof Error ? error.message : String(error)}). Install the optional testcontainers dependency, or pass --cluster.`,
              2,
            ),
        );
  try {
    const result = await squash(chain, {
      cluster: opened.handle,
      baselineDatabase: args.baseline,
      wrapTransactions: args.wrapTransactions,
    });
    const published = await publishSquashOutput(args.out, chain.length, result);
    if (!published.proofEqual) {
      fail(`squash proof failed; see ${join(args.out, "proof.json")}`, 1);
    }
    console.log(
      `wrote ${String(result.files.length)} files to ${args.out} (from ${String(chain.length)} inputs)`,
    );
  } finally {
    await opened.close();
  }
};

await main();
