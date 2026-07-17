/**
 * Test-process guard: turn any `process.exit()` call into a thrown Error while
 * the bun test runner is the host process.
 *
 * Why: CLI command handlers (src/cli/commands/*.ts) are called in-process by
 * tests (e.g. tests/profile-baseline.test.ts, tests/schema-apply-cron-guard.ts)
 * and are also embeddable as a library. If a handler ever calls `process.exit`
 * directly it tears down the WHOLE bun test process mid-run — the run aborts
 * with the raw exit code and NO test summary, silently masking every test that
 * would have run after it (this is exactly the regression this guard defends
 * against: `main()` must be the sole exiter, handlers throw
 * UsageError / CliExit / SchemaFrontendError instead).
 *
 * With this preload active, such a stray exit surfaces as an ordinary test
 * failure instead of a masked abort. It only affects the bun TEST process:
 * subprocess CLI runs spawned with `Bun.spawn(["bun", main.ts, …])`
 * (tests/cli.test.ts) get their own process and their real exit codes, because
 * this file is registered under bunfig's `[test].preload` (which does not apply
 * to plain `bun <script>` runs).
 *
 * Opt out with PGDELTA_ALLOW_PROCESS_EXIT=1 if a test legitimately needs the
 * real exit (none currently do).
 */
if (process.env["PGDELTA_ALLOW_PROCESS_EXIT"] !== "1") {
  process.exit = ((code?: number): never => {
    throw new Error(
      `process.exit(${code ?? 0}) called inside the test process — CLI command ` +
        `handlers must throw (UsageError / CliExit / SchemaFrontendError) and let ` +
        `main() be the sole exiter. Set PGDELTA_ALLOW_PROCESS_EXIT=1 to opt out.`,
    );
  }) as typeof process.exit;
}
