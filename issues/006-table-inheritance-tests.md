# Issue #006: Add Table Inheritance Test Coverage

## Priority: 🟡 Medium

## Description
Add comprehensive test coverage for PostgreSQL table inheritance using the `INHERITS` clause. While less common in modern applications, table inheritance is still used and creates complex dependency scenarios.

## Reference
- **Migra fixtures**: 
  - [`tests/FIXTURES/inherit/`](https://github.com/djrobstep/migra/tree/master/tests/FIXTURES/inherit)
  - [`tests/FIXTURES/inherit2/`](https://github.com/djrobstep/migra/tree/master/tests/FIXTURES/inherit2)
- **Migra test examples**: [inherit/a.sql](https://github.com/djrobstep/migra/blob/main/tests/FIXTURES/inherit/a.sql), [inherit/expected.sql](https://github.com/djrobstep/migra/blob/main/tests/FIXTURES/inherit/expected.sql)

## Missing Test Scenarios

### 1. Basic table inheritance
```sql
CREATE TABLE parent_table (
    id serial primary key,
    name text not null,
    created_at timestamp default now()
);

CREATE TABLE child_table (
    age integer,
    email text
) INHERITS (parent_table);
```

### 2. Multiple inheritance levels
```sql
CREATE TABLE grandparent (id serial, name text);
CREATE TABLE parent (age integer) INHERITS (grandparent);
CREATE TABLE child (email text) INHERITS (parent);
```

### 3. Add/remove inheritance relationships
```sql
-- Add inheritance to existing table
ALTER TABLE existing_table INHERIT parent_table;

-- Remove inheritance
ALTER TABLE child_table NO INHERIT parent_table;
```

### 4. Inheritance with constraints
```sql
CREATE TABLE parent_with_constraints (
    id serial primary key,
    amount numeric CHECK (amount > 0)
);

CREATE TABLE child_with_additional_constraints (
    category text CHECK (category IN ('A', 'B', 'C'))
) INHERITS (parent_with_constraints);
```

### 5. Inheritance dependency changes
```sql
-- Modify parent table structure affecting child tables
ALTER TABLE parent_table ADD COLUMN new_column text;
ALTER TABLE parent_table DROP COLUMN old_column;
```

## Implementation Plan

### File Location
- **New file**: `tests/integration/table-inheritance.test.ts`

### Test Structure
```typescript
/**
 * Integration tests for PostgreSQL table inheritance operations.
 */

import { describe } from "vitest";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { getTest } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTest(pgVersion);

  describe.concurrent(`table inheritance operations (pg${pgVersion})`, () => {
    test("basic table inheritance", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: `
          CREATE TABLE test_schema.parent_table (
            id serial primary key,
            name text not null,
            created_at timestamp default now()
          );

          CREATE TABLE test_schema.child_table (
            age integer,
            email text
          ) INHERITS (test_schema.parent_table);
        `,
      });
    });

    test("multiple inheritance levels", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: `
          CREATE TABLE test_schema.grandparent (
            id serial primary key, 
            name text
          );
          
          CREATE TABLE test_schema.parent (
            age integer
          ) INHERITS (test_schema.grandparent);
          
          CREATE TABLE test_schema.child (
            email text
          ) INHERITS (test_schema.parent);
        `,
      });
    });

    test("add inheritance to existing table", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.parent_table (
            id serial primary key,
            name text not null
          );
          CREATE TABLE test_schema.existing_table (
            id serial primary key,
            name text not null,
            extra_column text
          );
        `,
        testSql: `
          ALTER TABLE test_schema.existing_table INHERIT test_schema.parent_table;
        `,
      });
    });

    test("remove inheritance relationship", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.parent_table (
            id serial primary key,
            name text not null
          );
          CREATE TABLE test_schema.child_table (
            age integer
          ) INHERITS (test_schema.parent_table);
        `,
        testSql: `
          ALTER TABLE test_schema.child_table NO INHERIT test_schema.parent_table;
        `,
      });
    });

    test("inheritance with constraints", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: `
          CREATE TABLE test_schema.parent_with_constraints (
            id serial primary key,
            amount numeric CHECK (amount > 0)
          );

          CREATE TABLE test_schema.child_with_additional_constraints (
            category text CHECK (category IN ('A', 'B', 'C'))
          ) INHERITS (test_schema.parent_with_constraints);
        `,
      });
    });

    test("modify parent table affecting child", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.parent_table (
            id serial primary key,
            name text not null,
            old_column text
          );
          CREATE TABLE test_schema.child_table (
            age integer
          ) INHERITS (test_schema.parent_table);
        `,
        testSql: `
          ALTER TABLE test_schema.parent_table ADD COLUMN new_column text;
          ALTER TABLE test_schema.parent_table DROP COLUMN old_column;
        `,
      });
    });

    test("complex inheritance hierarchy with mixed operations", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.base (id serial primary key);
          CREATE TABLE test_schema.middle (name text) INHERITS (test_schema.base);
          CREATE TABLE test_schema.leaf1 (email text) INHERITS (test_schema.middle);
          CREATE TABLE test_schema.leaf2 (phone text) INHERITS (test_schema.middle);
        `,
        testSql: `
          -- Add column to middle of hierarchy
          ALTER TABLE test_schema.middle ADD COLUMN created_at timestamp default now();
          
          -- Remove one inheritance relationship
          ALTER TABLE test_schema.leaf2 NO INHERIT test_schema.middle;
          
          -- Add new leaf
          CREATE TABLE test_schema.leaf3 (address text) INHERITS (test_schema.middle);
        `,
      });
    });
  });
}
```

## Expected Behavior
- pg-diff should correctly detect inheritance relationships
- Should handle adding/removing inheritance with `INHERIT`/`NO INHERIT`
- Should properly order operations to respect inheritance dependencies
- Should handle parent table changes that affect child tables
- Should generate correct migration SQL that matches migra's output

## Acceptance Criteria
- [ ] All test cases pass for all supported PostgreSQL versions
- [ ] Test covers basic single-level inheritance
- [ ] Test covers multiple inheritance levels (grandparent → parent → child)
- [ ] Test covers adding inheritance to existing tables
- [ ] Test covers removing inheritance relationships
- [ ] Test covers inheritance with constraints
- [ ] Test covers parent table modifications affecting children
- [ ] Generated migration SQL is syntactically correct and functionally equivalent to migra

## Notes
- Table inheritance is less common in modern PostgreSQL applications (partitioning is often preferred)
- Inheritance creates complex dependency chains that must be handled carefully
- Consider the interaction between inheritance and other features (constraints, indexes, etc.)

## Estimated Effort
**3-4 days** - Higher complexity due to inheritance dependency modeling and edge cases.
