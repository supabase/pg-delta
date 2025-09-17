# Performance and error logging improvements

## Summary

Benchmark large schema diffs and improve error messages/logging for dependency or execution failures.

- Related migra issues:
  - [migra#179: Improve error messages for missing dependencies](https://github.com/djrobstep/migra/issues/179)
  - [migra#174: Detailed logging for migration failures](https://github.com/djrobstep/migra/issues/174)

## Acceptance tests (e2e)

1) Large schema benchmark
- Generate N schemas/tables/functions; assert diff completes within target time budget.

2) Missing dependency error clarity
- Create a view referencing a missing table; ensure error message points to the exact object and dependency chain.

## pg-diff analysis (feature vs test)

- Status: To test; possible enhancements.
- Evidence:
  - `src/logger.ts` exists; dependency solver provides cycle graphs; expose clearer messages.
- Action: Add perf harness and structured error messages; document targets.
