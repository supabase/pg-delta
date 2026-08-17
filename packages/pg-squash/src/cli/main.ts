#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import { readChain } from "../ingest/index.ts";
import { openClusterHandle } from "../shadow/index.ts";
import { squash } from "../squash.ts";
import type { ClusterHandle } from "../model/index.ts";

const USAGE = `pgsquash squash <migrations-dir> --out <dir> [--cluster <pg-url>] [--baseline <db>] [--image <docker-image>]

Compress an ordered migration chain into the minimum number of transactions
and write a proven equivalent chain to --out.

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
} => {
  const positionals: string[] = [];
  let out: string | undefined;
  let cluster: string | undefined;
  let baseline = "template0";
  let image = process.env["PGDELTA_TEST_IMAGE"] ?? "postgres:17-alpine";
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
  return { dir, out: outDir, cluster, baseline, image };
};

const handleFromUrl = async (
  url: string,
): Promise<{
  handle: ClusterHandle;
  close: () => Promise<void>;
}> => {
  const admin = new Pool({ connectionString: url, max: 3 });
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
  const opened = await handleFromUrl(url);
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
      ? await handleFromUrl(args.cluster)
      : await handleFromDocker(args.image).catch((error: unknown) =>
          fail(
            `--cluster is required (${error instanceof Error ? error.message : String(error)})`,
            2,
          ),
        );
  try {
    const result = await squash(chain, {
      cluster: opened.handle,
      baselineDatabase: args.baseline,
    });
    await mkdir(args.out, { recursive: true });
    for (const file of result.files) {
      await writeFile(join(args.out, file.name), file.sql);
    }
    await writeFile(
      join(args.out, "manifest.json"),
      `${JSON.stringify(result.manifest, null, 2)}\n`,
    );
    await writeFile(
      join(args.out, "proof.json"),
      `${JSON.stringify(result.proof, null, 2)}\n`,
    );
    const proofEqual =
      typeof result.proof === "object" &&
      result.proof !== null &&
      "equal" in result.proof &&
      result.proof.equal === true;
    await writeFile(
      join(args.out, "README.md"),
      `# Squashed migrations\n\n${String(chain.length)} input files → ${String(result.files.length)} output files.\nProof equal: ${String(proofEqual)}\n`,
    );
    if (!proofEqual) {
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
