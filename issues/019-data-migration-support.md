# Data migration support (beyond schema)

## Summary

Support optional data migration and transformations in addition to schema diffs.

- Related migra issues:
  - [migra#203: Support for data migration in addition to schema](https://github.com/djrobstep/migra/issues/203)
  - [migra#200: Handling data transformations during migration](https://github.com/djrobstep/migra/issues/200)

## Acceptance tests (e2e)

- Not applicable until scope defined; propose plugin/hooks for custom SQL blocks executed before/after schema changes.

## pg-diff analysis (feature vs test)

- Status: Feature request (non-goal for core unless agreed).
- Evidence:
  - Current tool is schema-focused.
- Action: Design proposal for extensible data hooks; out of core scope by default.
