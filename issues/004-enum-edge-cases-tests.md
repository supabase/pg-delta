# Issue #004: Add Enum Type Edge Cases Test Coverage

## Priority: 🔴 High

## Description
Extend existing enum type test coverage to handle complex edge cases including enum values with defaults, complex dependency changes, and enum type replacement patterns. These scenarios are complex but common in production.

## Reference
- **Migra fixtures**: 
  - [`tests/FIXTURES/enumdefaults/`](https://github.com/djrobstep/migra/tree/master/tests/FIXTURES/enumdefaults)
  - [`tests/FIXTURES/enumdeps/`](https://github.com/djrobstep/migra/tree/master/tests/FIXTURES/enumdeps)
- **Migra test examples**: [enumdefaults/a.sql](https://github.com/djrobstep/migra/blob/main/tests/FIXTURES/enumdefaults/a.sql), [enumdefaults/expected.sql](https://github.com/djrobstep/migra/blob/main/tests/FIXTURES/enumdefaults/expected.sql)

## Missing Test Scenarios

### 1. Enum with default values
```sql
CREATE TYPE order_status AS ENUM('pending', 'processing', 'complete');
CREATE TABLE orders(
  id serial primary key,
  status order_status default 'pending'::order_status,
  othercolumn other.otherenum1
);
```

### 2. Complex enum replacement with value addition
```sql
-- The complex pattern migra uses for enum value changes:
ALTER TABLE orders ALTER COLUMN status DROP DEFAULT;
ALTER TYPE order_status RENAME TO order_status__old_version_to_be_dropped;
CREATE TYPE order_status AS ENUM('pending', 'processing', 'complete', 'rejected');
ALTER TABLE orders ALTER COLUMN status TYPE order_status USING status::text::order_status;
ALTER TABLE orders ALTER COLUMN status SET DEFAULT 'pending'::order_status;
DROP TYPE order_status__old_version_to_be_dropped;
```

### 3. Cross-schema enum dependencies
```sql
CREATE SCHEMA other;
CREATE TYPE other.otherenum1 AS ENUM('a', 'b', 'c');
CREATE TYPE other.otherenum2 AS ENUM('a', 'b', 'c');

-- Change column to use different enum
ALTER TABLE orders ALTER COLUMN othercolumn 
SET DATA TYPE other.otherenum2 USING othercolumn::text::other.otherenum2;
```

### 4. Enum dependency chains
```sql
-- Multiple tables using the same enum type
-- Test proper ordering when enum type changes affect multiple tables
```

## Implementation Plan

### File Location
- **Extend existing file**: `tests/integration/type-operations.test.ts`

### Additional Test Cases
```typescript
test("enum with default values and cross-schema dependencies", async ({ db }) => {
  await roundtripFidelityTest({
    mainSession: db.main,
    branchSession: db.branch,
    initialSetup: `
      CREATE SCHEMA test_schema;
      CREATE SCHEMA other_schema;
    `,
    testSql: `
      CREATE TYPE test_schema.order_status AS ENUM('pending', 'processing', 'complete');
      CREATE TYPE other_schema.otherenum1 AS ENUM('a', 'b', 'c');
      CREATE TYPE other_schema.otherenum2 AS ENUM('a', 'b', 'c');
      
      CREATE TABLE test_schema.orders(
        id serial primary key,
        status test_schema.order_status default 'pending'::test_schema.order_status,
        othercolumn other_schema.otherenum1
      );
    `,
  });
});

test("complex enum value addition with default handling", async ({ db }) => {
  await roundtripFidelityTest({
    mainSession: db.main,
    branchSession: db.branch,
    initialSetup: `
      CREATE SCHEMA test_schema;
      CREATE TYPE test_schema.order_status AS ENUM('pending', 'processing', 'complete');
      CREATE TABLE test_schema.orders(
        id serial primary key,
        status test_schema.order_status default 'pending'::test_schema.order_status
      );
    `,
    testSql: `
      ALTER TABLE test_schema.orders ALTER COLUMN status DROP DEFAULT;
      ALTER TYPE test_schema.order_status RENAME TO order_status__old_version_to_be_dropped;
      CREATE TYPE test_schema.order_status AS ENUM('pending', 'processing', 'complete', 'rejected');
      ALTER TABLE test_schema.orders ALTER COLUMN status TYPE test_schema.order_status 
        USING status::text::test_schema.order_status;
      ALTER TABLE test_schema.orders ALTER COLUMN status SET DEFAULT 'pending'::test_schema.order_status;
      DROP TYPE test_schema.order_status__old_version_to_be_dropped;
    `,
  });
});

test("enum dependency change across schemas", async ({ db }) => {
  await roundtripFidelityTest({
    mainSession: db.main,
    branchSession: db.branch,
    initialSetup: `
      CREATE SCHEMA test_schema;
      CREATE SCHEMA other_schema;
      CREATE TYPE other_schema.otherenum1 AS ENUM('a', 'b', 'c');
      CREATE TYPE other_schema.otherenum2 AS ENUM('a', 'b', 'c');
      CREATE TABLE test_schema.orders(
        id serial primary key,
        othercolumn other_schema.otherenum1
      );
    `,
    testSql: `
      ALTER TABLE test_schema.orders ALTER COLUMN othercolumn 
      SET DATA TYPE other_schema.otherenum2 USING othercolumn::text::other_schema.otherenum2;
    `,
  });
});

test("multiple tables with same enum type modification", async ({ db }) => {
  await roundtripFidelityTest({
    mainSession: db.main,
    branchSession: db.branch,
    initialSetup: `
      CREATE SCHEMA test_schema;
      CREATE TYPE test_schema.status_type AS ENUM('active', 'inactive');
      CREATE TABLE test_schema.users(
        id serial primary key,
        status test_schema.status_type default 'active'::test_schema.status_type
      );
      CREATE TABLE test_schema.products(
        id serial primary key,
        status test_schema.status_type default 'active'::test_schema.status_type
      );
    `,
    testSql: `
      -- Modify enum type used by multiple tables
      ALTER TABLE test_schema.users ALTER COLUMN status DROP DEFAULT;
      ALTER TABLE test_schema.products ALTER COLUMN status DROP DEFAULT;
      ALTER TYPE test_schema.status_type RENAME TO status_type__old_version_to_be_dropped;
      CREATE TYPE test_schema.status_type AS ENUM('active', 'inactive', 'pending');
      ALTER TABLE test_schema.users ALTER COLUMN status TYPE test_schema.status_type 
        USING status::text::test_schema.status_type;
      ALTER TABLE test_schema.products ALTER COLUMN status TYPE test_schema.status_type 
        USING status::text::test_schema.status_type;
      ALTER TABLE test_schema.users ALTER COLUMN status SET DEFAULT 'active'::test_schema.status_type;
      ALTER TABLE test_schema.products ALTER COLUMN status SET DEFAULT 'active'::test_schema.status_type;
      DROP TYPE test_schema.status_type__old_version_to_be_dropped;
    `,
  });
});

test("enum type with complex default expressions", async ({ db }) => {
  await roundtripFidelityTest({
    mainSession: db.main,
    branchSession: db.branch,
    initialSetup: `
      CREATE SCHEMA test_schema;
      CREATE TYPE test_schema.priority AS ENUM('low', 'medium', 'high');
    `,
    testSql: `
      CREATE TABLE test_schema.tasks(
        id serial primary key,
        title text,
        priority test_schema.priority default 'medium'::test_schema.priority,
        created_at timestamp default now()
      );
    `,
  });
});
```

## Expected Behavior
- pg-diff should correctly detect complex enum modification patterns
- Should handle the temporary rename pattern for enum value additions
- Should properly manage default value dropping and restoration
- Should handle cross-schema enum dependencies
- Should generate correct migration SQL that matches migra's complex enum handling

## Acceptance Criteria
- [ ] All test cases pass for all supported PostgreSQL versions
- [ ] Test covers enum types with default values
- [ ] Test covers the complex enum replacement pattern (rename → create → convert → drop)
- [ ] Test covers cross-schema enum dependencies
- [ ] Test covers multiple tables using the same enum type
- [ ] Test covers enum default value handling during type changes
- [ ] Generated migration SQL is syntactically correct and functionally equivalent to migra

## Notes
- This extends existing enum tests rather than creating a new file
- The enum replacement pattern is complex and critical for production use
- May require improvements to dependency ordering logic

## Estimated Effort
**2-3 days** - Moderate complexity due to the intricate enum replacement patterns and dependency handling.
