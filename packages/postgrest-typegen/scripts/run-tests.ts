/**
 * Test runner that resolves global-setup and test paths from this script's
 * location, so `bun run test` works correctly whether invoked from the
 * package directory or from the monorepo root (e.g. via `bun run --filter '*' test`).
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = join(import.meta.dir, "..");
const globalSetup = join(pkgRoot, "test", "global-setup.ts");
const args = process.argv.slice(2);

const coveragePreload = fileURLToPath(
  import.meta.resolve("@supabase/bun-istanbul-coverage/preload"),
);
const coverageArgs =
  process.env.BUN_COVERAGE === "1" ? ["--preload", coveragePreload] : [];

const proc = Bun.spawn({
  cmd: [
    "bun",
    "test",
    ...coverageArgs,
    "--preload",
    globalSetup,
    "--timeout",
    "15000",
    "--concurrent",
    "--max-concurrency",
    "8",
    ...args,
  ],
  cwd: pkgRoot,
  stdio: ["inherit", "inherit", "inherit"],
});

const exitCode = await proc.exited;
process.exit(exitCode);
