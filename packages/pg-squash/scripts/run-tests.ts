/**
 * Test runner wrapper. With `BUN_COVERAGE` unset it is a transparent
 * passthrough to `bun test <args>`. When `BUN_COVERAGE=1` it injects the
 * `@supabase/bun-istanbul-coverage` preload.
 */
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);

const coveragePreload = fileURLToPath(
  import.meta.resolve("@supabase/bun-istanbul-coverage/preload"),
);
const coverageArgs =
  process.env.BUN_COVERAGE === "1" ? ["--preload", coveragePreload] : [];

const proc = Bun.spawn({
  cmd: ["bun", "test", ...coverageArgs, ...args],
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  stdio: ["inherit", "inherit", "inherit"],
});

const exitCode = await proc.exited;
process.exit(exitCode);
