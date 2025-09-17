# Issue #009: Add Comprehensive Integration Test

## Priority: 🟢 Low

## Description
Add a comprehensive integration test that combines multiple PostgreSQL object types and operations in a single complex scenario. This mirrors migra's "everything" fixture and serves as a regression test for real-world complexity.

## Reference
- **Migra fixture**: [`tests/FIXTURES/everything/`](https://github.com/djrobstep/migra/tree/master/tests/FIXTURES/everything)
- **Migra test examples**: [everything/a.sql](https://github.com/djrobstep/migra/blob/main/tests/FIXTURES/everything/a.sql), [everything/b.sql](https://github.com/djrobstep/migra/blob/main/tests/FIXTURES/everything/b.sql), [everything/expected.sql](https://github.com/djrobstep/migra/blob/main/tests/FIXTURES/everything/expected.sql)

## Test Scenario Overview

The comprehensive test should include a complex scenario with:

### 1. Multiple schemas
```sql
CREATE SCHEMA goodschema;
CREATE SCHEMA evenbetterschema;
```

### 2. Extensions
```sql
CREATE EXTENSION hstore;
CREATE EXTENSION citext;
```

### 3. Custom types
```sql
CREATE TYPE shipping_status AS ENUM ('not shipped', 'shipped', 'delivered');
CREATE TYPE bug_status AS ENUM ('new', 'open', 'closed');
CREATE TYPE unused_enum AS ENUM ('a', 'b', 'c');
```

### 4. Tables with complex relationships
```sql
CREATE TABLE products (
    product_no serial primary key,
    name text,
    price numeric not null default 100,
    x integer,
    newcolumn text,
    newcolumn2 interval,
    constraint x check (price > 10),
    constraint y check (price > 0)
);

CREATE TABLE orders (
    order_id integer primary key unique,
    shipping_address text,
    status shipping_status,
    status2 text,
    h hstore
);

CREATE TABLE order_items (
    product_no integer REFERENCES products ON DELETE RESTRICT,
    order_id integer REFERENCES orders ON DELETE CASCADE,
    quantity integer,
    PRIMARY KEY (product_no, order_id)
);
```

### 5. Views and materialized views
```sql
CREATE VIEW vvv AS SELECT 2 as a;
CREATE MATERIALIZED VIEW matvvv AS SELECT 2 as a;
```

### 6. Functions
```sql
CREATE OR REPLACE FUNCTION changed(i integer, t text[])
RETURNS TABLE(a text, c integer) AS $$
DECLARE
BEGIN
    SELECT 'no', 1;
END;
$$ LANGUAGE PLPGSQL VOLATILE RETURNS NULL ON NULL INPUT SECURITY DEFINER;

CREATE OR REPLACE FUNCTION newfunc(i integer, t text[])
RETURNS TABLE(a text, c integer) AS $$
DECLARE
BEGIN
    SELECT 'no', 1;
END;
$$ LANGUAGE PLPGSQL STABLE RETURNS NULL ON NULL INPUT SECURITY INVOKER;
```

### 7. Indexes and constraints
```sql
CREATE INDEX ON products(name);
CREATE UNIQUE INDEX ON orders(order_id);
```

### 8. Privileges
```sql
GRANT UPDATE, INSERT ON TABLE products TO postgres;
```

## Implementation Plan

### File Location
- **New file**: `tests/integration/comprehensive-schema.test.ts`

### Test Structure
```typescript
/**
 * Comprehensive integration test covering multiple PostgreSQL object types.
 * Based on migra's "everything" fixture.
 */

import { describe } from "vitest";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { getTest } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTest(pgVersion);

  describe.concurrent(`comprehensive schema operations (pg${pgVersion})`, () => {
    test("complex real-world schema changes", async ({ db }) => {
      await roundtripFidelityTest({
        name: "comprehensive-schema-test",
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          -- Extensions
          CREATE EXTENSION IF NOT EXISTS hstore;
          
          -- Schemas
          CREATE SCHEMA goodschema;
          CREATE SCHEMA badschema;
          
          -- Types
          CREATE TYPE shipping_status AS ENUM ('not shipped', 'shipped');
          CREATE TYPE unwanted_enum AS ENUM ('unwanted', 'not wanted');
          CREATE TYPE unused_enum AS ENUM ('a', 'b');
          CREATE TYPE usage_dropped_enum AS ENUM ('x', 'y');
          
          -- Tables with various features
          CREATE TABLE columnless_table();
          CREATE UNLOGGED TABLE change_to_logged();
          CREATE TABLE change_to_unlogged();
          
          CREATE TABLE aunwanted (
            id serial primary key,
            name text not null
          );
          
          CREATE TABLE orders (
            order_id serial primary key,
            shipping_address text,
            status shipping_status,
            status2 usage_dropped_enum
          );
          
          CREATE TABLE products (
            product_no integer,
            name varchar(10) not null unique,
            price numeric,
            x integer not null default 7 unique,
            oldcolumn text,
            constraint x check (price > 0),
            z integer REFERENCES orders ON DELETE CASCADE,
            zz integer REFERENCES aunwanted ON DELETE CASCADE
          );
          
          -- Indexes
          CREATE UNIQUE INDEX ON products(x);
          CREATE UNIQUE INDEX ON orders(order_id);
          CREATE INDEX ON products(price);
          
          -- Views
          CREATE VIEW vvv AS SELECT * FROM products;
          CREATE MATERIALIZED VIEW matvvv AS SELECT * FROM products;
          
          -- Privileges
          GRANT SELECT, INSERT ON TABLE products TO postgres;
          
          -- Functions
          CREATE OR REPLACE FUNCTION changed(i integer, t text[])
          RETURNS TABLE(a text, c integer) AS $$
          DECLARE
          BEGIN
            RETURN QUERY SELECT 'no'::text, 1;
          END;
          $$ LANGUAGE PLPGSQL STABLE RETURNS NULL ON NULL INPUT SECURITY DEFINER;
        `,
        testSql: `
          -- Add new extension
          CREATE EXTENSION IF NOT EXISTS citext;
          
          -- Schema changes
          CREATE SCHEMA evenbetterschema;
          DROP SCHEMA badschema;
          
          -- Type modifications
          ALTER TYPE shipping_status RENAME TO shipping_status__old;
          CREATE TYPE shipping_status AS ENUM ('not shipped', 'shipped', 'delivered');
          
          CREATE TYPE bug_status AS ENUM ('new', 'open', 'closed');
          ALTER TYPE unused_enum RENAME TO unused_enum__old;
          CREATE TYPE unused_enum AS ENUM ('a', 'b', 'c');
          
          -- Table modifications
          CREATE TABLE columnless_table2();
          ALTER TABLE change_to_logged SET LOGGED;
          ALTER TABLE change_to_unlogged SET UNLOGGED;
          
          -- Complex table restructuring
          DROP TABLE aunwanted CASCADE;
          
          ALTER TABLE products DROP COLUMN oldcolumn;
          ALTER TABLE products ADD COLUMN newcolumn text;
          ALTER TABLE products ADD COLUMN newcolumn2 interval;
          ALTER TABLE products ALTER COLUMN product_no SET NOT NULL;
          ALTER TABLE products ADD PRIMARY KEY (product_no);
          ALTER TABLE products ALTER COLUMN name TYPE text;
          ALTER TABLE products ALTER COLUMN price SET NOT NULL;
          ALTER TABLE products ALTER COLUMN price SET DEFAULT 100;
          ALTER TABLE products ALTER COLUMN x DROP NOT NULL;
          ALTER TABLE products DROP CONSTRAINT x;
          ALTER TABLE products ADD CONSTRAINT x CHECK (price > 10);
          ALTER TABLE products ADD CONSTRAINT y CHECK (price > 0);
          ALTER TABLE products DROP COLUMN z;
          ALTER TABLE products DROP COLUMN zz;
          
          -- Orders table changes
          ALTER TABLE orders ALTER COLUMN order_id TYPE integer;
          ALTER TABLE orders ALTER COLUMN status TYPE shipping_status 
            USING status::text::shipping_status;
          ALTER TABLE orders ALTER COLUMN status2 TYPE text 
            USING status2::text;
          ALTER TABLE orders ADD COLUMN h hstore;
          
          -- New table with complex relationships
          CREATE TABLE order_items (
            product_no integer REFERENCES products ON DELETE RESTRICT,
            order_id integer REFERENCES orders ON DELETE CASCADE,
            quantity integer,
            PRIMARY KEY (product_no, order_id)
          );
          
          -- Index changes
          DROP INDEX products_price_idx;
          CREATE INDEX ON products(name);
          
          -- View updates
          DROP VIEW vvv CASCADE;
          CREATE VIEW vvv AS SELECT 2 as a;
          CREATE MATERIALIZED VIEW matvvv AS SELECT 2 as a;
          
          -- Privilege changes
          REVOKE SELECT ON TABLE products FROM postgres;
          GRANT UPDATE ON TABLE products TO postgres;
          
          -- Function changes
          DROP FUNCTION changed(integer, text[]);
          CREATE OR REPLACE FUNCTION changed(i integer, t text[])
          RETURNS TABLE(a text, c integer) AS $$
          DECLARE
          BEGIN
            RETURN QUERY SELECT 'no'::text, 1;
          END;
          $$ LANGUAGE PLPGSQL VOLATILE RETURNS NULL ON NULL INPUT SECURITY DEFINER;
          
          CREATE OR REPLACE FUNCTION newfunc(i integer, t text[])
          RETURNS TABLE(a text, c integer) AS $$
          DECLARE
          BEGIN
            RETURN QUERY SELECT 'no'::text, 1;
          END;
          $$ LANGUAGE PLPGSQL STABLE RETURNS NULL ON NULL INPUT SECURITY INVOKER;
          
          -- New table with enum
          CREATE TABLE bug (
            id serial,
            description text,
            status text -- Using text instead of bug_status for now
          );
          
          -- Cleanup unused types
          DROP TYPE unwanted_enum;
          DROP TYPE shipping_status__old;
          DROP TYPE unused_enum__old;
        `,
      });
    });

    test("comprehensive dependency ordering", async ({ db }) => {
      await roundtripFidelityTest({
        name: "dependency-ordering-comprehensive",
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA app;
          CREATE TYPE app.status AS ENUM ('active', 'inactive');
          CREATE TABLE app.users (id serial primary key, status app.status);
        `,
        testSql: `
          -- Complex changes requiring careful ordering
          CREATE SCHEMA billing;
          CREATE TYPE billing.payment_status AS ENUM ('pending', 'paid', 'failed');
          
          CREATE TABLE billing.payments (
            id serial primary key,
            user_id integer REFERENCES app.users(id),
            status billing.payment_status default 'pending',
            amount numeric(10,2) CHECK (amount > 0)
          );
          
          CREATE VIEW app.user_payments AS 
          SELECT u.id, u.status as user_status, p.amount, p.status as payment_status
          FROM app.users u
          LEFT JOIN billing.payments p ON u.id = p.user_id;
          
          CREATE FUNCTION app.get_user_total(user_id integer) 
          RETURNS numeric AS $$
          SELECT COALESCE(SUM(amount), 0) FROM billing.payments WHERE user_id = $1;
          $$ LANGUAGE SQL STABLE;
          
          -- Add indexes
          CREATE INDEX ON billing.payments(user_id);
          CREATE INDEX ON billing.payments(status);
          
          -- Add privileges
          GRANT SELECT ON app.users TO postgres;
          GRANT SELECT, INSERT ON billing.payments TO postgres;
        `,
      });
    });
  });
}
```

## Expected Behavior
- pg-diff should handle the complex mix of object types and dependencies correctly
- Should generate migrations in the correct order to avoid dependency conflicts
- Should handle cascading changes (like dropping tables with foreign key references)
- Should properly manage type replacements and enum modifications
- Should serve as a regression test for complex real-world scenarios

## Acceptance Criteria
- [ ] All test cases pass for all supported PostgreSQL versions
- [ ] Test covers mixed object types (tables, views, functions, types, indexes, etc.)
- [ ] Test covers complex dependency chains and cascading changes
- [ ] Test covers schema modifications, table restructuring, and privilege changes
- [ ] Test covers extension management within complex scenarios
- [ ] Test handles type replacements and enum modifications correctly
- [ ] Generated migration SQL is syntactically correct and maintains data integrity
- [ ] Test serves as effective regression test for complex scenarios

## Notes
- This test is primarily for regression testing and comprehensive coverage
- Should be based on real-world complexity patterns
- May need to be adjusted based on available extensions and PostgreSQL features
- Consider making this test optional or skippable in limited environments

## Estimated Effort
**2-3 days** - Moderate complexity but primarily involves combining existing patterns into a comprehensive test scenario.
