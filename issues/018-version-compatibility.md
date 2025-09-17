# PostgreSQL version compatibility coverage

## Summary

Validate behavior across supported versions and features.

- Related migra issues:
  - [migra#191: Compatibility with PostgreSQL 13](https://github.com/djrobstep/migra/issues/191)
  - [migra#182: Handle new PostgreSQL features in migrations](https://github.com/djrobstep/migra/issues/182)

## Acceptance tests (e2e)

- Run full roundtrip suite on PG 15, 16, 17 (per PLAN.md) and include targeted features (ICU collations, identity, generated cols, RLS, etc.).

## pg-diff analysis (feature vs test)

- Status: To test.
- Evidence:
  - `PLAN.md` states support for 15–17; ensure CI matrix and fixtures cover deltas.
- Action: Extend integration matrix, add fixtures per version.
