# Support PostgreSQL RULES (pg_rewrite / CREATE RULE)

## Summary

Support detecting and diffing PostgreSQL rewrite rules (`CREATE RULE`).

- Related migra issues:
  - [migra#97: Support rules](https://github.com/djrobstep/migra/issues/97)

## Acceptance tests (e2e)

1) Create rule on table

```sql
-- initialSetup
CREATE TABLE s.t(id int, archived boolean default false);

-- testSql (branch)
CREATE RULE t_no_update_when_archived AS
  ON UPDATE TO s.t
  WHERE NEW.archived = true
  DO INSTEAD NOTHING;
```

Expected: Diff includes the CREATE RULE for the table with correct qualifier and predicate/action.

2) Drop rule

```sql
-- initialSetup
CREATE TABLE s.t(id int, archived boolean default false);
CREATE RULE t_no_update_when_archived AS
  ON UPDATE TO s.t
  WHERE NEW.archived = true
  DO INSTEAD NOTHING;

-- testSql (branch)
DROP RULE t_no_update_when_archived ON s.t;
```

Expected: Diff drops the rule.

## pg-diff analysis (feature vs test)

- Status: Feature request.
- Evidence:
  - No rule model present; `REFERENCE.md` documents `pg_rewrite` fields; `PLAN.md` lists Rules as a target.
- Action: Implement extraction from `pg_rewrite` plus `pg_get_ruledef`, model and diff rules, and serialize create/drop. Add ordering with tables.
