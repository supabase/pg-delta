# Schema and object filtering (restrict output to specific objects)

## Summary

Add CLI/API options to restrict diff output to specific schemas and/or object names (tables, views, functions), similar to migra requests.

- Related migra issues:
  - [migra#28: Restrict output to specified object/table names](https://github.com/djrobstep/migra/issues/28)

## Acceptance tests (e2e)

1) Restrict to a schema

- Setup multiple schemas with objects; run diff with `--schemas s1` and expect only objects from `s1` in output.

2) Restrict to a list of objects

- Provide `--objects s1.t1,s1.v1,s2.f1()` and expect only those objects in the diff.

3) Interaction with dependencies

- If object filter includes a view that depends on a table, ensure either:
  - the dependent objects are auto-included (documented behavior), or
  - the diff errors with a clear dependency message unless `--include-deps` is set.

## pg-diff analysis (feature vs test)

- Status: Feature request.
- Evidence:
  - Existing `issues/008-schema-filtering-tests.md` focuses on schema filtering tests. Object-name filtering appears unimplemented.
- Action: Design filter layer over extracted catalogs before diffing; ensure dependency-aware inclusion; add tests above.
