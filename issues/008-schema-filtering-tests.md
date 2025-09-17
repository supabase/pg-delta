# Issue #008: Add Schema Filtering Test Coverage

## Priority: 🟡 Medium

## Description
Add comprehensive test coverage for schema filtering operations including single schema operations, schema exclusion patterns, and cross-schema dependency handling. This is important for large applications with multiple schemas.

## Reference
- **Migra fixtures**: 
  - [`tests/FIXTURES/singleschema/`](https://github.com/djrobstep/migra/tree/master/tests/FIXTURES/singleschema)
  - [`tests/FIXTURES/excludeschema/`](https://github.com/djrobstep/migra/tree/master/tests/FIXTURES/excludeschema)
- **Migra test examples**: [singleschema/a.sql](https://github.com/djrobstep/migra/blob/main/tests/FIXTURES/singleschema/a.sql), [excludeschema/expected.sql](https://github.com/djrobstep/migra/blob/main/tests/FIXTURES/excludeschema/expected.sql)

## Missing Test Scenarios

### 1. Single schema operations
```sql
-- Only compare/migrate objects in 'goodschema'
CREATE SCHEMA goodschema;
CREATE SCHEMA ignoredschema;

CREATE TABLE goodschema.users (id serial, name text);
CREATE TABLE ignoredschema.logs (id serial, message text); -- Should be ignored
```

### 2. Schema exclusion patterns
```sql
-- Exclude 'excludedschema' from comparison
CREATE SCHEMA mainschema;
CREATE SCHEMA excludedschema;

CREATE TABLE mainschema.users (id serial, name text);
CREATE TABLE excludedschema.internal_logs (id serial, data text); -- Should be excluded
```

### 3. Cross-schema dependencies
```sql
-- Test how filtering handles cross-schema references
CREATE SCHEMA schema_a;
CREATE SCHEMA schema_b;

CREATE TABLE schema_a.users (id serial primary key, name text);
CREATE TABLE schema_b.orders (
    id serial primary key,
    user_id integer REFERENCES schema_a.users(id)
);
```

### 4. Schema filtering with different object types
```sql
-- Ensure filtering works across all object types
CREATE SCHEMA included;
CREATE SCHEMA excluded;

-- Tables, views, functions, types in both schemas
CREATE TABLE included.table1 (id int);
CREATE VIEW included.view1 AS SELECT * FROM included.table1;
CREATE TYPE included.enum1 AS ENUM ('a', 'b');
CREATE FUNCTION included.func1() RETURNS int AS $$ SELECT 1; $$ LANGUAGE SQL;

CREATE TABLE excluded.table2 (id int); -- Should be filtered out
CREATE VIEW excluded.view2 AS SELECT * FROM excluded.table2; -- Should be filtered out
```

## Implementation Plan

### File Location
- **New file**: `tests/integration/schema-filtering.test.ts`

### Test Structure
```typescript
/**
 * Integration tests for PostgreSQL schema filtering operations.
 */

import { describe } from "vitest";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { getTest } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTest(pgVersion);

  describe.concurrent(`schema filtering operations (pg${pgVersion})`, () => {
    test("single schema focus", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA goodschema;
          CREATE SCHEMA ignoredschema;
        `,
        testSql: `
          CREATE TABLE goodschema.users (id serial, name text);
          CREATE TABLE ignoredschema.logs (id serial, message text);
          
          -- Only changes in goodschema should be detected
          ALTER TABLE goodschema.users ADD COLUMN email text;
        `,
        // Note: This test would need schema filtering support in the test framework
      });
    });

    test("schema exclusion", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA mainschema;
          CREATE SCHEMA excludedschema;
        `,
        testSql: `
          CREATE TABLE mainschema.users (id serial, name text);
          CREATE TABLE excludedschema.internal_logs (id serial, data text);
          
          -- Only changes in mainschema should be detected
          ALTER TABLE mainschema.users ADD COLUMN created_at timestamp;
          ALTER TABLE excludedschema.internal_logs ADD COLUMN ignored_column text; -- Should be ignored
        `,
      });
    });

    test("cross-schema dependencies with filtering", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA schema_a;
          CREATE SCHEMA schema_b;
          CREATE SCHEMA excluded_schema;
        `,
        testSql: `
          CREATE TABLE schema_a.users (id serial primary key, name text);
          CREATE TABLE schema_b.orders (
            id serial primary key,
            user_id integer REFERENCES schema_a.users(id)
          );
          CREATE TABLE excluded_schema.logs (
            id serial primary key,
            user_id integer -- No FK, should be ignored
          );
        `,
      });
    });

    test("schema filtering with mixed object types", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA included;
          CREATE SCHEMA excluded;
        `,
        testSql: `
          -- Objects in included schema
          CREATE TABLE included.table1 (id int);
          CREATE VIEW included.view1 AS SELECT * FROM included.table1;
          CREATE TYPE included.enum1 AS ENUM ('a', 'b');
          CREATE FUNCTION included.func1() RETURNS int AS $$ SELECT 1; $$ LANGUAGE SQL;
          CREATE SEQUENCE included.seq1;
          
          -- Objects in excluded schema (should be filtered out)
          CREATE TABLE excluded.table2 (id int);
          CREATE VIEW excluded.view2 AS SELECT * FROM excluded.table2;
          CREATE TYPE excluded.enum2 AS ENUM ('x', 'y');
          CREATE FUNCTION excluded.func2() RETURNS int AS $$ SELECT 2; $$ LANGUAGE SQL;
        `,
      });
    });

    test("public schema with filtering", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA app;
          CREATE SCHEMA internal;
        `,
        testSql: `
          -- Public schema objects
          CREATE TABLE public.global_config (key text, value text);
          
          -- App schema objects (should be included)
          CREATE TABLE app.users (id serial, name text);
          
          -- Internal schema objects (should be excluded)
          CREATE TABLE internal.audit_log (id serial, action text);
        `,
      });
    });

    test("schema filtering with complex dependencies", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA main_app;
          CREATE SCHEMA shared_types;
          CREATE SCHEMA excluded_internal;
        `,
        testSql: `
          -- Shared types schema
          CREATE TYPE shared_types.status AS ENUM ('active', 'inactive');
          
          -- Main app using shared types
          CREATE TABLE main_app.users (
            id serial primary key,
            name text,
            status shared_types.status default 'active'
          );
          
          -- Internal schema using shared types (should be excluded but type dependency remains)
          CREATE TABLE excluded_internal.admin_logs (
            id serial primary key,
            status shared_types.status
          );
        `,
      });
    });
  });
}
```

## Expected Behavior
- pg-diff should support schema inclusion/exclusion options
- Should correctly filter objects based on schema patterns
- Should handle cross-schema dependencies appropriately when filtering
- Should work consistently across all object types (tables, views, functions, etc.)
- Should generate correct migration SQL that respects schema filtering

## Acceptance Criteria
- [ ] All test cases pass for all supported PostgreSQL versions
- [ ] Test covers single schema inclusion filtering
- [ ] Test covers schema exclusion patterns
- [ ] Test covers cross-schema dependency handling with filtering
- [ ] Test covers filtering across all object types
- [ ] Test covers public schema interaction with filtering
- [ ] Test handles complex cross-schema dependencies correctly
- [ ] Generated migration SQL respects schema filtering rules

## Notes
- This feature may require extending the pg-diff API to support schema filtering options
- Cross-schema dependencies create complexity when filtering
- Consider how schema filtering interacts with existing dependency ordering logic
- May need to extend the test framework to support filtering options

## Estimated Effort
**3-4 days** - Higher complexity due to dependency handling and potential API extensions needed.
