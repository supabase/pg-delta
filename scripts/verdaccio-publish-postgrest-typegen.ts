/**
 * Build `@supabase/postgrest-typegen` and publish it to the locally-running
 * Verdaccio with a fresh `0.0.0-local.<unix-ts>` version, then restore the
 * working-copy version so the repo stays clean. Pair with
 * `bun run verdaccio:start`.
 *
 * This is the Phase 2 byte-parity loop (PGMETA-112): publish locally, point
 * postgres-meta at the local registry, and run its typegen snapshot suite
 * before anything is published to npm.
 *
 * Usage:
 *   bun run verdaccio:start              # in one shell
 *   bun run postgrest-typegen:publish-local
 *   bun run postgrest-typegen:publish-local --registry=http://localhost:4873/
 *
 * Then, in postgres-meta (do NOT commit the .npmrc override):
 *   echo '@supabase:registry=http://localhost:4873/' >> .npmrc
 *   npm install @supabase/postgrest-typegen@<printed-version>
 */
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");
const packageRoot = join(repoRoot, "packages", "postgrest-typegen");
const packageJsonPath = join(packageRoot, "package.json");
const defaultRegistry = "http://localhost:4873/";

function log(msg: string) {
  console.log(`\n=== ${msg} ===`);
}

// Throw rather than `process.exit(1)`: `process.exit` terminates synchronously
// without unwinding `try`/`finally`, so calling it from inside `main()`'s `try`
// block would skip the package.json version restore and leave the working copy
// bumped. The top-level `main().catch(...)` logs and exits non-zero for us.
function fail(msg: string): never {
  throw new Error(msg);
}

function parseRegistry(): string {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--registry=")) {
      return arg.slice("--registry=".length);
    }
    if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: bun run postgrest-typegen:publish-local [--registry=<url>]",
      );
      process.exit(0);
    }
    fail(`Unknown argument: ${arg}`);
  }
  return defaultRegistry;
}

// npm refuses to POST a publish without an auth token configured for the
// target registry, even when the registry would accept anonymous. Derive the
// per-registry config key (`//<host>[:<port>][<path>]/:_authToken`) from the
// URL so we can pass `--<key>=<dummy>` to `npm publish`. Verdaccio with
// `publish: $all` ignores the token value.
function authTokenFlag(registry: string): string {
  const stripped = registry.replace(/^https?:/i, "").replace(/\/+$/, "");
  return `--${stripped}/:_authToken=local-anon-token`;
}

async function run(cmd: string[], cwd: string): Promise<number> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
  return proc.exited;
}

interface PkgJson {
  name: string;
  version: string;
  [key: string]: unknown;
}

async function readJson(path: string): Promise<PkgJson> {
  return JSON.parse(await readFile(path, "utf8")) as PkgJson;
}

async function writeJson(path: string, value: PkgJson): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function main(): Promise<void> {
  const registry = parseRegistry();

  const pkg = await readJson(packageJsonPath);
  const originalVersion = pkg.version;
  const localVersion = `0.0.0-local.${Math.floor(Date.now() / 1000)}`;

  log(
    `Publishing ${pkg.name} as ${localVersion} (working copy will be restored to ${originalVersion})`,
  );

  pkg.version = localVersion;
  await writeJson(packageJsonPath, pkg);

  try {
    log("Building postgrest-typegen");
    const buildExit = await run(
      ["bun", "run", "--filter", "@supabase/postgrest-typegen", "build"],
      repoRoot,
    );
    if (buildExit !== 0) fail("postgrest-typegen build failed");

    log(`Publishing to ${registry}`);
    // Use `npm publish` (not `bun publish`) because Verdaccio handles npm's
    // protocol most reliably for anonymous local registries.
    const publishExit = await run(
      [
        "npm",
        "publish",
        "--registry",
        registry,
        "--tag",
        "local",
        "--access",
        "public",
        authTokenFlag(registry),
      ],
      packageRoot,
    );
    if (publishExit !== 0) fail("npm publish failed");
  } finally {
    // Always restore the working-copy version, even on failure.
    const restored = await readJson(packageJsonPath);
    restored.version = originalVersion;
    await writeJson(packageJsonPath, restored);
  }

  log(`Published version: ${localVersion}`);
  console.log(
    "\nTo consume from postgres-meta (do NOT commit the .npmrc override):\n" +
      `  echo '@supabase:registry=${registry}' >> .npmrc\n` +
      `  npm install @supabase/postgrest-typegen@${localVersion}`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
