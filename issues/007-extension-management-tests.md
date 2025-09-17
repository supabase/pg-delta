# Issue #007: Add Extension Management Test Coverage

## Priority: 🟡 Medium

## Description
Add comprehensive test coverage for PostgreSQL extension management including version changes, extension-only migrations, and extension dependency handling. Extensions are critical for PostgreSQL ecosystems but have limited test coverage.

## Reference
- **Migra fixtures**: 
  - [`tests/FIXTURES/singleschema_ext/`](https://github.com/djrobstep/migra/tree/master/tests/FIXTURES/singleschema_ext)
  - [`tests/FIXTURES/extversions/`](https://github.com/djrobstep/migra/tree/master/tests/FIXTURES/extversions)
- **Migra test examples**: [extversions/a.sql](https://github.com/djrobstep/migra/blob/main/tests/FIXTURES/extversions/a.sql), [extversions/expected.sql](https://github.com/djrobstep/migra/blob/main/tests/FIXTURES/extversions/expected.sql)

## Missing Test Scenarios

### 1. Extension creation and removal
```sql
CREATE EXTENSION pg_trgm;
CREATE EXTENSION hstore;
CREATE EXTENSION citext;

-- Later remove unused extensions
DROP EXTENSION IF EXISTS pg_trgm;
```

### 2. Extension version updates
```sql
-- Update extension to newer version
ALTER EXTENSION pg_trgm UPDATE TO '1.5';
```

### 3. Extension-only migrations (create-extensions-only mode)
```sql
-- Migrations that only handle extension changes without schema changes
CREATE EXTENSION IF NOT EXISTS uuid_ossp;
CREATE EXTENSION IF NOT EXISTS postgis;
```

### 4. Extension dependencies with schema objects
```sql
CREATE EXTENSION hstore;

-- Create table using extension types
CREATE TABLE test_table (
    id serial primary key,
    data hstore,
    search_vector tsvector
);

-- Extension removal should be blocked by dependencies
```

### 5. Extension schema placement
```sql
-- Extensions in specific schemas
CREATE EXTENSION pg_trgm SCHEMA extensions;
```

## Implementation Plan

### File Location
- **New file**: `tests/integration/extension-operations.test.ts`

### Test Structure
```typescript
/**
 * Integration tests for PostgreSQL extension operations.
 */

import { describe } from "vitest";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { getTest } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTest(pgVersion);

  describe.concurrent(`extension operations (pg${pgVersion})`, () => {
    test("create and drop extensions", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "",
        testSql: `
          CREATE EXTENSION IF NOT EXISTS pg_trgm;
          CREATE EXTENSION IF NOT EXISTS hstore;
          CREATE EXTENSION IF NOT EXISTS citext;
        `,
      });
    });

    test("remove unused extension", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE EXTENSION IF NOT EXISTS pg_trgm;
          CREATE EXTENSION IF NOT EXISTS hstore;
        `,
        testSql: `
          DROP EXTENSION IF EXISTS pg_trgm;
        `,
      });
    });

    test("extension version updates", async ({ db }) => {
      // Note: This test may be environment-dependent based on available versions
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE EXTENSION IF NOT EXISTS pg_trgm;
        `,
        testSql: `
          -- Update to available version (test will adapt to environment)
          ALTER EXTENSION pg_trgm UPDATE;
        `,
      });
    });

    test("extension with schema objects", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE EXTENSION IF NOT EXISTS hstore;
        `,
        testSql: `
          CREATE TABLE test_schema.test_table (
            id serial primary key,
            data hstore,
            name text
          );
          
          CREATE INDEX idx_test_data ON test_schema.test_table USING gin(data);
        `,
      });
    });

    test("extension in specific schema", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA extensions;
        `,
        testSql: `
          CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA extensions;
        `,
      });
    });

    test("multiple extensions with dependencies", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
        `,
        testSql: `
          CREATE EXTENSION IF NOT EXISTS hstore;
          CREATE EXTENSION IF NOT EXISTS citext;
          
          CREATE TABLE test_schema.mixed_types (
            id serial primary key,
            email citext,
            metadata hstore,
            created_at timestamp default now()
          );
        `,
      });
    });

    test("extension removal with dependency cleanup", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE EXTENSION IF NOT EXISTS hstore;
          CREATE TABLE test_schema.test_table (
            id serial primary key,
            data hstore
          );
        `,
        testSql: `
          -- Remove table first, then extension
          DROP TABLE test_schema.test_table;
          DROP EXTENSION IF EXISTS hstore;
        `,
      });
    });

    test("common PostgreSQL extensions", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "",
        testSql: `
          -- Test commonly available extensions
          CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
          CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
          CREATE EXTENSION IF NOT EXISTS btree_gin;
        `,
      });
    });
  });
}
```

## Expected Behavior
- pg-diff should correctly detect extension creation and removal
- Should handle extension version updates when applicable
- Should respect extension dependencies with schema objects
- Should handle extension schema placement
- Should generate correct migration SQL that matches migra's output

## Acceptance Criteria
- [ ] All test cases pass for all supported PostgreSQL versions
- [ ] Test covers extension creation and removal
- [ ] Test covers extension version updates (where applicable)
- [ ] Test covers extension dependencies with schema objects
- [ ] Test covers extension schema placement
- [ ] Test covers common PostgreSQL extensions (uuid-ossp, hstore, etc.)
- [ ] Test handles extension removal with dependency cleanup
- [ ] Generated migration SQL is syntactically correct and functionally equivalent to migra

## Notes
- Extension availability varies by PostgreSQL installation and version
- Some tests may need to be conditional based on available extensions
- Consider testing with both contrib and third-party extensions
- Extension version updates depend on available versions in the system

## Estimated Effort
**2-3 days** - Moderate complexity due to environment dependencies and version handling.
