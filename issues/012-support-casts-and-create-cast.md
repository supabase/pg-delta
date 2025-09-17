# Support CAST/CREATE CAST

## Summary

Detect and diff custom casts. Generate `CREATE CAST` statements when present only on one side.

- Related migra issues:
  - [migra#109: Add support for CAST/CREATE CAST](https://github.com/djrobstep/migra/issues/109)

## Acceptance tests (e2e)

1) Create cast between domains/types

```sql
-- initialSetup
CREATE TYPE s.usd AS ENUM ('USD');
CREATE TYPE s.eur AS ENUM ('EUR');

-- testSql (branch)
-- Example illustrative cast (real cast may use functions and context)
CREATE FUNCTION s.usd_to_text(s.usd) RETURNS text LANGUAGE sql AS $$ SELECT $1::text $$;
CREATE CAST (s.usd AS text) WITH FUNCTION s.usd_to_text(s.usd) AS ASSIGNMENT;
```

Expected: Diff includes the `CREATE FUNCTION` then `CREATE CAST` in correct order.

2) Drop cast

```sql
-- initialSetup
CREATE FUNCTION s.usd_to_text(s.usd) RETURNS text LANGUAGE sql AS $$ SELECT $1::text $$;
CREATE CAST (s.usd AS text) WITH FUNCTION s.usd_to_text(s.usd) AS ASSIGNMENT;

-- testSql (branch)
DROP CAST IF EXISTS (s.usd AS text);
```

Expected: Diff drops the cast.

## pg-diff analysis (feature vs test)

- Status: Feature request.
- Evidence:
  - No matches for `CREATE CAST` in codebase; `PLAN.md` lists Casts as a target item.
- Action: Implement cast extraction (from `pg_cast` plus function/operator references), modeling, diffing, and serialization. Add tests above.
