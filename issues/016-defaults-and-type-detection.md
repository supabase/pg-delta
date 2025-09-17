# Defaults and column type detection

## Summary

Detect and diff changes to column defaults and type alterations accurately.

- Related migra issues:
  - [migra#146: Default values not detected as changes](https://github.com/djrobstep/migra/issues/146)
  - [migra#162: Column type changes not recognized](https://github.com/djrobstep/migra/issues/162)

## Acceptance tests (e2e)

1) Default expression change

```sql
-- initialSetup
CREATE TABLE s.t(id int default 1);

-- testSql (branch)
ALTER TABLE s.t ALTER COLUMN id SET DEFAULT 2;
```

Expected: Diff includes ALTER COLUMN ... SET DEFAULT with correct expression normalization.

2) Type change with USING

```sql
-- initialSetup
CREATE TABLE s.t(varchar_col varchar(10));

-- testSql (branch)
ALTER TABLE s.t ALTER COLUMN varchar_col TYPE varchar(20);
```

Expected: Diff includes ALTER TYPE change; if USING is required (non-trivial cast), include USING clause.

## pg-diff analysis (feature vs test)

- Status: To test / verify.
- Evidence:
  - Table diff and alter logic exist; needs coverage for default normalization and type changes.
- Action: Add integration tests above across supported PG versions.
