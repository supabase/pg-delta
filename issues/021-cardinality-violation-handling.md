# CardinalityViolation handling in catalog queries

## Summary

Ensure catalog queries handle expected row counts to avoid cardinality violations in edge cases.

- Related migra issues:
  - [migra#108: Get a CardinalityViolation error](https://github.com/djrobstep/migra/issues/108)

## Acceptance tests (e2e)

- Reproduce conditions where catalog joins might duplicate rows (e.g., multiple default ACLs, ambiguous dependencies) and confirm queries use DISTINCT or appropriate filters.

## pg-diff analysis (feature vs test)

- Status: To test; code hardening.
- Evidence:
  - Extraction SQL uses explicit filters and `set search_path = ''`; review for DISTINCT and null-handling.
- Action: Add tests and adjust queries to guarantee single-row expectations.
