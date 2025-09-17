# Issue #005: Add Collations Test Coverage

## Priority: 🟡 Medium

## Description
Add comprehensive test coverage for PostgreSQL collations. Collations are important for internationalization and text sorting but currently lack test coverage in pg-diff.

## Reference
- **Migra fixture**: [`tests/FIXTURES/collations/`](https://github.com/djrobstep/migra/tree/master/tests/FIXTURES/collations)
- **Migra test examples**: [a.sql](https://github.com/djrobstep/migra/blob/main/tests/FIXTURES/collations/a.sql), [b.sql](https://github.com/djrobstep/migra/blob/main/tests/FIXTURES/collations/b.sql), [expected.sql](https://github.com/djrobstep/migra/blob/main/tests/FIXTURES/collations/expected.sql)

## Missing Test Scenarios

### 1. Create collations
```sql
CREATE COLLATION posix FROM "POSIX";
CREATE COLLATION numeric (provider = icu, locale = 'en-u-kn-true');
```

### 2. Table columns with collations
```sql
CREATE TABLE t(
  a text,
  b text collate posix,
  c text collate numeric
);
```

### 3. Alter column collation
```sql
ALTER TABLE t ALTER COLUMN b SET DATA TYPE text COLLATE numeric USING b::text;
```

### 4. Drop unused collations
```sql
DROP COLLATION IF EXISTS posix;
```

## Implementation Plan

### File Location
- **New file**: `tests/integration/collation-operations.test.ts`

### Test Structure
```typescript
/**
 * Integration tests for PostgreSQL collation operations.
 */

import { describe } from "vitest";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { getTest } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTest(pgVersion);

  describe.concurrent(`collation operations (pg${pgVersion})`, () => {
    test("create collations", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: `
          CREATE COLLATION test_schema.posix FROM "POSIX";
          CREATE COLLATION test_schema.numeric (provider = icu, locale = 'en-u-kn-true');
        `,
      });
    });

    test("table columns with collations", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE COLLATION test_schema.posix FROM "POSIX";
          CREATE COLLATION test_schema.numeric (provider = icu, locale = 'en-u-kn-true');
        `,
        testSql: `
          CREATE TABLE test_schema.t(
            a text,
            b text collate test_schema.posix,
            c text collate test_schema.numeric
          );
        `,
      });
    });

    test("alter column collation", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE COLLATION test_schema.posix FROM "POSIX";
          CREATE COLLATION test_schema.numeric (provider = icu, locale = 'en-u-kn-true');
          CREATE TABLE test_schema.t(
            a text,
            b text collate test_schema.posix
          );
        `,
        testSql: `
          ALTER TABLE test_schema.t ADD COLUMN c text collate test_schema.numeric;
          ALTER TABLE test_schema.t ALTER COLUMN b 
            SET DATA TYPE text COLLATE test_schema.numeric USING b::text;
        `,
      });
    });

    test("drop unused collations", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE COLLATION test_schema.posix FROM "POSIX";
          CREATE COLLATION test_schema.numeric (provider = icu, locale = 'en-u-kn-true');
          CREATE TABLE test_schema.t(
            a text,
            b text collate test_schema.posix
          );
        `,
        testSql: `
          ALTER TABLE test_schema.t ALTER COLUMN b 
            SET DATA TYPE text COLLATE test_schema.numeric USING b::text;
          ALTER TABLE test_schema.t ADD COLUMN c text collate test_schema.numeric;
          DROP COLLATION IF EXISTS test_schema.posix;
        `,
      });
    });

    test("collation dependencies", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE COLLATION test_schema.custom_collation (provider = icu, locale = 'en-US');
        `,
        testSql: `
          CREATE TABLE test_schema.users(
            id serial primary key,
            name text collate test_schema.custom_collation,
            email text collate test_schema.custom_collation
          );
          
          CREATE INDEX idx_users_name ON test_schema.users(name);
        `,
      });
    });
  });
}
```

## Expected Behavior
- pg-diff should correctly detect collation creation and removal
- Should handle column collation changes with proper USING clauses
- Should manage collation dependencies correctly
- Should generate correct migration SQL that matches migra's output

## Acceptance Criteria
- [ ] All test cases pass for all supported PostgreSQL versions
- [ ] Test covers collation creation with different providers (ICU, libc)
- [ ] Test covers table columns with collations
- [ ] Test covers altering column collations
- [ ] Test covers dropping unused collations
- [ ] Test handles collation dependencies (tables, indexes)
- [ ] Generated migration SQL is syntactically correct and functionally equivalent to migra

## Notes
- Collation support may vary by PostgreSQL version and system configuration
- ICU collations require PostgreSQL to be compiled with ICU support
- Consider testing with both system and custom collations

## Estimated Effort
**2-3 days** - Moderate complexity due to collation system dependencies and version variations.
