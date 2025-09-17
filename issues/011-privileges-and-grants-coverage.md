# Privileges and grants coverage (functions, sequences, tables, schemas)

## Summary
Cover and, if needed, implement diffing for grants/revokes on functions, sequences, tables, views, and schemas.

- Related migra issues:
  - [migra#64: Grants/revokes on functions + sequences](https://github.com/djrobstep/migra/issues/64)

## Acceptance tests (e2e)

1) Function EXECUTE privilege

```sql
-- initialSetup
CREATE SCHEMA s;
CREATE OR REPLACE FUNCTION s.f1() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;

-- testSql (branch)
GRANT EXECUTE ON FUNCTION s.f1() TO postgres;
```

Expected: Diff includes GRANT EXECUTE ON FUNCTION and roundtrips.

2) Sequence USAGE/SELECT privileges

```sql
-- initialSetup
CREATE SEQUENCE s.seq1;

-- testSql (branch)
GRANT USAGE, SELECT ON SEQUENCE s.seq1 TO postgres;
```

Expected: Diff includes correct GRANTs/REVOKEs.

3) Table/View privileges and revoke/change

```sql
-- initialSetup
CREATE TABLE s.t(id int);
CREATE VIEW s.v AS SELECT * FROM s.t;

-- testSql (branch)
GRANT SELECT, INSERT ON TABLE s.t TO postgres;
GRANT SELECT ON TABLE s.v TO postgres;
```

Expected: Diffs reflect GRANT additions and REVOKE changes.

4) Schema privileges

```sql
-- initialSetup
CREATE SCHEMA private_schema;

-- testSql (branch)
GRANT USAGE, CREATE ON SCHEMA private_schema TO postgres;
```

Expected: Diffs include schema-level grants.

## pg-diff analysis (feature vs test)

- Status: Feature + tests likely needed.
- Evidence:
  - `issues/003-privileges-grants-tests.md` outlines scenarios, but extraction/diffing is not yet implemented in `src/objects/**`.
  - `DEPENDENCIES.md` includes a `privilege` kind as metadata, indicating intent to model.
- Action: Implement privilege extraction and diffing, then add integration tests above.
