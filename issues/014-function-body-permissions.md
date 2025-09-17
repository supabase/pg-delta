# Function body handling when permissions are insufficient

## Summary

Ensure robust extraction/serialization of function bodies when the connecting role cannot read function source/body. Avoid emitting `$$None$$` or corrupt definitions.

- Related migra issues:
  - [migra#14: Function's body is being replaced with $$None$$ when permissions are insufficient](https://github.com/djrobstep/migra/issues/14)

## Acceptance tests (e2e)

1) Limited permission role (read-only) comparing identical functions

```sql
-- initialSetup
CREATE SCHEMA s;
CREATE OR REPLACE FUNCTION s.f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;

-- test harness step (outside SQL): connect as a role without access to view internal prosrc/sqlbody
-- testSql (branch)
-- no changes
```

Expected: pg-diff does not output an invalid replacement; either omits body when identical or surfaces a clear warning without corrupt SQL.

2) Diffing body change with insufficient permissions

```sql
-- initialSetup main
CREATE OR REPLACE FUNCTION s.f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;

-- testSql (branch)
CREATE OR REPLACE FUNCTION s.f() RETURNS int LANGUAGE sql AS $$ SELECT 2 $$;
```

Expected: When connected with limited privileges, behavior is safe: either fails clearly with actionable error or requires elevated role; never emits `$$None$$`.

## pg-diff analysis (feature vs test)

- Status: To test / verify.
- Evidence:
  - Procedure extraction uses `pg_get_functiondef` and excludes languages `c` and `internal`. It likely returns complete SQL when permitted.
  - Need to test under restricted roles; if catalog access returns nulls, ensure serializer does not print invalid content.
- Action: Add tests using a restricted role and assert outputs are safe and accurate; add error handling if needed.
