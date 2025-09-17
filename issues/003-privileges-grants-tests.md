# Issue #003: Add Privileges and Grants Test Coverage

## Priority: 🔴 High

## Description
Add comprehensive test coverage for PostgreSQL privileges and grants (`GRANT`/`REVOKE` operations). Database security and permissions are critical but currently lack test coverage in pg-diff.

## Reference
- **Migra fixture**: [`tests/FIXTURES/privileges/`](https://github.com/djrobstep/migra/tree/master/tests/FIXTURES/privileges)
- **Migra test examples**: [a.sql](https://github.com/djrobstep/migra/blob/main/tests/FIXTURES/privileges/a.sql), [expected.sql](https://github.com/djrobstep/migra/blob/main/tests/FIXTURES/privileges/expected.sql)

## Missing Test Scenarios

### 1. Grant table privileges
```sql
CREATE TABLE any_table (id serial primary key, name text not null);
GRANT SELECT, INSERT ON TABLE any_table TO postgres;
```

### 2. Revoke and modify privileges
```sql
REVOKE SELECT ON TABLE any_table FROM postgres;
GRANT UPDATE ON TABLE any_table TO postgres;
```

### 3. View privileges
```sql
CREATE VIEW any_view AS SELECT * FROM any_table;
GRANT SELECT ON TABLE any_view TO postgres;
```

### 4. Function privileges
```sql
CREATE OR REPLACE FUNCTION any_function(i integer, t text[])
RETURNS TABLE(a text, c integer) AS $$
DECLARE
BEGIN
    SELECT 'no', 1;
END;
$$ LANGUAGE PLPGSQL STABLE RETURNS NULL ON NULL INPUT SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION any_function(integer, text[]) TO postgres;
```

### 5. Schema privileges
```sql
CREATE SCHEMA private_schema;
GRANT USAGE ON SCHEMA private_schema TO postgres;
GRANT CREATE ON SCHEMA private_schema TO postgres;
```

## Implementation Plan

### File Location
- **New file**: `tests/integration/privilege-operations.test.ts`

### Test Structure
```typescript
/**
 * Integration tests for PostgreSQL privilege and grant operations.
 */

import { describe } from "vitest";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { getTest } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTest(pgVersion);

  describe.concurrent(`privilege operations (pg${pgVersion})`, () => {
    test("grant table privileges", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.any_table (
            id serial primary key, 
            name text not null
          );
        `,
        testSql: `
          GRANT SELECT, INSERT ON TABLE test_schema.any_table TO postgres;
        `,
      });
    });

    test("revoke and change table privileges", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.any_table (
            id serial primary key, 
            name text not null
          );
          GRANT SELECT, INSERT ON TABLE test_schema.any_table TO postgres;
        `,
        testSql: `
          REVOKE SELECT ON TABLE test_schema.any_table FROM postgres;
          GRANT UPDATE ON TABLE test_schema.any_table TO postgres;
        `,
      });
    });

    test("view privileges", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.any_table (
            id serial primary key, 
            name text not null
          );
          CREATE VIEW test_schema.any_view AS SELECT * FROM test_schema.any_table;
        `,
        testSql: `
          GRANT SELECT ON TABLE test_schema.any_view TO postgres;
        `,
      });
    });

    test("function privileges", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE OR REPLACE FUNCTION test_schema.any_function(i integer, t text[])
          RETURNS TABLE(a text, c integer) AS $$
          DECLARE
          BEGIN
              RETURN QUERY SELECT 'no'::text, 1;
          END;
          $$ LANGUAGE PLPGSQL STABLE RETURNS NULL ON NULL INPUT SECURITY DEFINER;
        `,
        testSql: `
          GRANT EXECUTE ON FUNCTION test_schema.any_function(integer, text[]) TO postgres;
        `,
      });
    });

    test("schema privileges", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA private_schema;
        `,
        testSql: `
          GRANT USAGE ON SCHEMA private_schema TO postgres;
          GRANT CREATE ON SCHEMA private_schema TO postgres;
        `,
      });
    });

    test("multiple privilege operations", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.any_table (
            id serial primary key, 
            name text not null
          );
          CREATE VIEW test_schema.any_view AS SELECT * FROM test_schema.any_table;
          CREATE VIEW test_schema.any_other_view AS SELECT * FROM test_schema.any_table;
          GRANT SELECT, INSERT ON TABLE test_schema.any_table TO postgres;
        `,
        testSql: `
          REVOKE SELECT ON TABLE test_schema.any_table FROM postgres;
          DROP VIEW test_schema.any_other_view;
          GRANT UPDATE ON TABLE test_schema.any_table TO postgres;
        `,
      });
    });

    test("role-based privileges", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE ROLE test_role;
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.any_table (
            id serial primary key, 
            name text not null
          );
        `,
        testSql: `
          GRANT SELECT ON TABLE test_schema.any_table TO test_role;
          GRANT INSERT ON TABLE test_schema.any_table TO test_role;
        `,
      });
    });
  });
}
```

## Expected Behavior
- pg-diff should correctly detect privilege grants and revocations
- Should handle table, view, function, and schema privileges
- Should properly format role names and privilege types
- Should generate correct migration SQL that matches migra's output

## Acceptance Criteria
- [ ] All test cases pass for all supported PostgreSQL versions
- [ ] Test covers table privileges (SELECT, INSERT, UPDATE, DELETE)
- [ ] Test covers view privileges
- [ ] Test covers function privileges (EXECUTE)
- [ ] Test covers schema privileges (USAGE, CREATE)
- [ ] Test covers role-based privileges
- [ ] Test covers privilege revocation
- [ ] Generated migration SQL is syntactically correct and functionally equivalent to migra

## Notes
- May require extending the catalog model to include privilege information
- Should test with both built-in roles (postgres) and custom roles
- Consider testing ALL PRIVILEGES shorthand

## Estimated Effort
**3-4 days** - Higher complexity due to privilege system modeling and multiple object types.
