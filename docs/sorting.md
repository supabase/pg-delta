# Sorting & Migration Safety

`pg-diff` generates migration scripts that are both **safe to execute** and **easy to review**. This is achieved through a sophisticated sorting algorithm that balances database constraints with human readability.

## Overview

When generating a migration script, `pg-diff` organizes changes to satisfy two competing goals:

1. **Correctness**: Statements execute in the right order for PostgreSQL (e.g., create a table before its indexes)
2. **Readability**: Related changes are grouped together for easier code review

## How It Works

The sorting engine uses a two-pass strategy:

1. **Logical Organization**: Groups related changes together (by schema, by table, etc.)
2. **Dependency Resolution**: Adjusts ordering to satisfy PostgreSQL's requirements

This means your migration scripts will have all changes to `public.users` grouped together, while still ensuring that tables are created before their foreign keys reference them.

## Execution Phases

Migrations are organized into two distinct phases:

### DROP Phase (Destructive Operations)

Runs first, in **reverse dependency order**:
- Drops dependents before their dependencies
- Example: Drop a foreign key before dropping the referenced table

### CREATE/ALTER Phase (Constructive Operations)

Runs second, in **forward dependency order**:
- Creates dependencies before their dependents
- Example: Create a role before assigning it as a table owner

## Dependency Sources

`pg-diff` automatically handles dependencies from multiple sources:

| Source | Description | Example |
|:-------|:------------|:--------|
| **Database Catalog** | Dependencies tracked by PostgreSQL (`pg_depend`) | Views depending on tables |
| **Explicit Requirements** | Dependencies declared in object definitions | Column referencing a type |
| **Logical Rules** | Business logic requirements | Default privileges before table creation |

## Handling Circular Dependencies

Real-world schemas sometimes contain circular dependencies (e.g., two tables with mutual foreign key references).

`pg-diff` handles this by:

1. Detecting the cycle
2. Identifying if any constraint can be deferred (created separately via `ALTER TABLE`)
3. Breaking the cycle by separating the constraint
4. Re-sorting the changes

If a cycle cannot be broken (only hard dependencies remain), `pg-diff` throws a detailed error explaining the cycle.

## Examples

### Basic Dependency Resolution

**Input changes:**
1. `CREATE TABLE posts` (owner: `admin`)
2. `CREATE ROLE admin`

**Output (reordered):**
1. `CREATE ROLE admin`
2. `CREATE TABLE posts`

The role must exist before it can own a table.

### Logical Grouping

**Input changes:**
1. `CREATE TABLE users`
2. `CREATE TABLE posts`
3. `CREATE INDEX users_email_idx ON users`
4. `CREATE INDEX posts_author_idx ON posts`

**Output (grouped by table):**
1. `CREATE TABLE users`
2. `CREATE INDEX users_email_idx ON users`
3. `CREATE TABLE posts`
4. `CREATE INDEX posts_author_idx ON posts`

Related objects are kept together for easier review.

### Default Privileges Ordering

**Input changes:**
1. `CREATE TABLE users`
2. `ALTER DEFAULT PRIVILEGES ... GRANT SELECT ON TABLES`

**Output (reordered):**
1. `ALTER DEFAULT PRIVILEGES ... GRANT SELECT ON TABLES`
2. `CREATE TABLE users`

Default privileges must be set before tables are created for them to inherit the correct permissions.

## Stable Identifiers

`pg-diff` uses stable string identifiers to track objects across environments (since PostgreSQL OIDs change between databases):

| Object Type | Identifier Format | Example |
|:------------|:------------------|:--------|
| Schema Object | `type:schema.name` | `table:public.users` |
| Sub-entity | `type:schema.parent.name` | `column:public.users.email` |
| Metadata | `scope:target` | `comment:public.users` |

These identifiers ensure consistent dependency tracking regardless of the underlying database.

