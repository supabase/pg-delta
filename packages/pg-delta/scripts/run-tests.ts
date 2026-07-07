/**
 * Test runner wrapper. With `BUN_COVERAGE` unset it is a transparent
 * passthrough to `bun test <args>`, so `bun run test` / `test:integration` /
 * `test:all` behave exactly as a bare `bun test src/` etc. When `BUN_COVERAGE=1`
 * it injects the `@supabase/bun-istanbul-coverage` preload so source files are
 * Istanbul-instrumented and per-process coverage JSON is written to
 * `NYC_OUTPUT_DIR` (consumed by `nyc report` via the root `bun run coverage`).
 *
 * This mirrors `packages/pg-topo/scripts/run-tests.ts`. pg-delta tests manage
 * their own containers (`tests/containers.ts`) and need no global-setup preload,
 * so the wrapper adds nothing else — CI keeps invoking `bun test` directly.
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
