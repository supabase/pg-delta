# Issue #002: Add Generated Columns Test Coverage

## Priority: 🔴 High

## Description
Add comprehensive test coverage for PostgreSQL generated columns (`GENERATED ALWAYS AS (...) STORED`). These computed columns are commonly used for derived values but currently lack test coverage in pg-diff.

## Reference
- **Migra fixture**: [`tests/FIXTURES/generated/`](https://github.com/djrobstep/migra/tree/master/tests/FIXTURES/generated)
- **Migra test examples**: [a.sql](https://github.com/djrobstep/migra/blob/main/tests/FIXTURES/generated/a.sql), [b.sql](https://github.com/djrobstep/migra/blob/main/tests/FIXTURES/generated/b.sql), [expected.sql](https://github.com/djrobstep/migra/blob/main/tests/FIXTURES/generated/expected.sql)

## Missing Test Scenarios

### 1. Create table with generated columns
```sql
CREATE TABLE demo_gencol (
    id serial PRIMARY KEY,
    the_column TEXT GENERATED ALWAYS AS ('the original generated value') STORED,
    the_column2 text
);
```

### 2. Add generated expression to existing column
```sql
ALTER TABLE demo_gencol ADD COLUMN new_col text 
GENERATED ALWAYS AS ('computed_' || id::text) STORED;
```

### 3. Remove generated expression from column
```sql
ALTER TABLE demo_gencol ALTER COLUMN the_column DROP EXPRESSION;
```

### 4. Modify generated expression
```sql
-- Drop and recreate column with different expression
ALTER TABLE demo_gencol DROP COLUMN the_column2;
ALTER TABLE demo_gencol ADD COLUMN the_column2 TEXT 
GENERATED ALWAYS AS ('new expression') STORED;
```

### 5. Generated columns with complex expressions
```sql
CREATE TABLE complex_generated (
    id serial,
    first_name text,
    last_name text,
    full_name text GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED,
    name_length int GENERATED ALWAYS AS (length(first_name || ' ' || last_name)) STORED
);
```

## Implementation Plan

### File Location
- **New file**: `tests/integration/generated-columns.test.ts`

### Test Structure
```typescript
/**
 * Integration tests for PostgreSQL generated column operations.
 */

import { describe } from "vitest";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { getTest } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTest(pgVersion);

  describe.concurrent(`generated column operations (pg${pgVersion})`, () => {
    test("create table with generated columns", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: `
          CREATE TABLE test_schema.demo_gencol (
            id serial PRIMARY KEY,
            the_column TEXT GENERATED ALWAYS AS ('the original generated value') STORED,
            the_column2 text
          );
        `,
      });
    });

    test("drop generated expression from column", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.demo_gencol (
            id serial PRIMARY KEY,
            the_column TEXT GENERATED ALWAYS AS ('the original generated value') STORED,
            the_column2 text
          );
        `,
        testSql: `
          ALTER TABLE test_schema.demo_gencol ALTER COLUMN the_column DROP EXPRESSION;
        `,
      });
    });

    test("recreate column with different generated expression", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.demo_gencol (
            id serial PRIMARY KEY,
            the_column TEXT GENERATED ALWAYS AS ('the original generated value') STORED,
            the_column2 text
          );
        `,
        testSql: `
          ALTER TABLE test_schema.demo_gencol DROP COLUMN the_column2;
          ALTER TABLE test_schema.demo_gencol ADD COLUMN the_column2 TEXT 
          GENERATED ALWAYS AS ('the original generated value'::text) STORED;
        `,
      });
    });

    test("complex generated expressions", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: `
          CREATE TABLE test_schema.complex_generated (
            id serial,
            first_name text,
            last_name text,
            full_name text GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED,
            name_length int GENERATED ALWAYS AS (length(first_name || ' ' || last_name)) STORED
          );
        `,
      });
    });

    test("add generated column to existing table", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.users (
            id serial PRIMARY KEY,
            first_name text,
            last_name text
          );
        `,
        testSql: `
          ALTER TABLE test_schema.users ADD COLUMN full_name text 
          GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED;
        `,
      });
    });
  });
}
```

## Expected Behavior
- pg-diff should correctly detect generated column creation, modification, and removal
- Should handle the `ALTER COLUMN ... DROP EXPRESSION` syntax
- Should properly handle generated expressions with complex SQL
- Should generate correct migration SQL that matches migra's output

## Acceptance Criteria
- [ ] All test cases pass for all supported PostgreSQL versions
- [ ] Test covers generated column creation and removal
- [ ] Test covers dropping expressions from generated columns
- [ ] Test covers modifying generated expressions (via drop/recreate)
- [ ] Test handles complex generated expressions with functions and operators
- [ ] Generated migration SQL is syntactically correct and functionally equivalent to migra

## Estimated Effort
**2-3 days** - Moderate complexity due to generated expression parsing and modification handling.
