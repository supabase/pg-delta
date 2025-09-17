# RFC: Supabase-Specific Database Migration Tool Requirements

## Executive Summary

We need to build a database migration tool that handles Supabase-specific elements beyond standard PostgreSQL schema differences. Our current schema diff tools miss critical Supabase components that are essential for maintaining platform functionality during migrations.

## Problem Statement

When we migrate between two PostgreSQL databases where one or both are Supabase instances, we lose:

- Extension configurations and data
- Authentication service state
- Storage bucket configurations
- Realtime publications
- Edge function database dependencies
- Platform-specific migration histories

**We must solve this to enable reliable database migrations for our users.**

## Scope and Boundaries

To keep the core database diff/migration engine focused and safe, we explicitly split scope:

- In scope (Engine):
  - DDL for user-owned schemas (tables, views, indexes, types, functions, triggers, constraints)
  - RLS policies and grants on user schemas
  - Extension presence DDL (CREATE EXTENSION ...) excluding extension internals
  - Publications DDL for non-default publications; skip default `supabase_realtime`
  - User-created roles only; never migrate reserved roles
- Out of scope (CLI/system orchestration):
  - `pgsodium` encryption keys (must be copied via Supabase API)
  - Actual storage files (object storage sync handled outside the DB)
  - Auth user/session data (PII); default exclude, allow in non-prod via explicit CLI flag
  - Edge Functions code/deployment config and environment variables
  - Environment-specific webhook URLs/secrets (e.g., `net.http_post` endpoints)
  - Realtime active subscriptions (ephemeral)
  - Pending/archived messages for `pgmq` (optional CLI flag; default recreate empty queues)
  - Bulk vector embeddings data (optional CLI flag, or regenerate embeddings)
  - Large-scale `storage.objects` metadata copies (optional CLI flag with batching)
  - Service migration/history tables copied verbatim as service state (CLI-managed)

## Understanding Supabase Architecture

What makes Supabase different from standard PostgreSQL.

### Supabase Platform Components

Supabase extends PostgreSQL with several services that store state in the database:

1. **Auth Service** - Manages users, sessions, identities in `auth` schema
2. **Storage Service** - Manages file buckets and metadata in `storage` schema
3. **Realtime Service** - Uses PostgreSQL publications for live subscriptions
4. **Edge Functions** - Call database functions with elevated privileges
5. **Extensions** - Add functionality like cron jobs, queues, vector search

### Schema Architecture

Supabase databases have a specific schema structure we must respect:

```
├── auth/                    # Authentication service (Supabase managed)
├── storage/                 # File storage service (Supabase managed)
├── realtime/               # Realtime service (Supabase managed)
├── supabase_functions/     # Edge functions metadata (Supabase managed)
├── supabase_migrations/    # CLI migration history (user managed)
├── extensions/             # Extension schema (Supabase managed)
├── cron/                   # pg_cron extension (extension managed)
├── pgmq/                   # Message queues (extension managed)
├── net/                    # HTTP client (extension managed)
├── pgsodium/              # Encryption (extension managed)
└── public/                # User data (user managed)
```

### Current CLI Migration Logic

Our existing CLI already handles some of these patterns. We need to learn from and extend this logic:

**Schema Classification (from `/pkg/migration/dump.go`):**

```go
// Schemas we never migrate structure for
InternalSchemas = []string{
    "information_schema", "pg_*",
    "_analytics", "_realtime", "_supavisor",
    "auth", "extensions", "pgbouncer", "realtime", "storage",
    "supabase_functions", "supabase_migrations",
    "cron", "dbdev", "graphql", "net", "pgmq", "pgsodium"
}

// Schemas we migrate data for but not structure
excludedSchemas = []string{
    // Includes: "auth", "storage", "cron", "net", "pgmq"
    // Excludes: "graphql", "pgsodium", "realtime", "extensions"
}
```

**Reserved Roles (never migrate):**

```go
reservedRoles = []string{
    "anon", "authenticated", "authenticator", "dashboard_user",
    "supabase_admin", "supabase_auth_admin", "service_role",
    "pgsodium_keyholder", "pgtle_admin", // ... 17 total
}
```

## Detailed Requirements Analysis

### 1. PostgreSQL Extensions

**What we need to handle:**

Extensions in Supabase fall into three categories:

#### Core Extensions (always present)

- `pg_graphql`, `pg_net`, `pgcrypto`, `pgjwt`, `pgsodium`, `uuid-ossp`
- **Migration approach**: Detect presence, ensure they exist in target
- **Data handling**: No data migration needed (auto-managed ?)

#### Optional Extensions (user-installed)

- `pg_cron`, `pgmq`, `vector`, `postgis`, `timescaledb`
- **Migration approach**: Detect, create extension, migrate configuration data
- **Data handling**: Varies by extension (detailed below)

#### System Extensions (ignore)

- `plpgsql`, `supabase_vault`
- **Migration approach**: Skip entirely ?

#### Specific Extension Requirements:

**pg_cron (Job Scheduling):**

- **DDL**: `CREATE EXTENSION pg_cron WITH SCHEMA pg_catalog;`
- **Data**: Migrate `cron.job` table entries
- **Dependencies**: Jobs reference functions - must create functions first
- **Generate**: `SELECT cron.schedule('name', 'schedule', 'command');` calls

**pgmq (Message Queues):**

- **DDL**: `CREATE EXTENSION pgmq;`
- **Data**: Detect queue tables (`pgmq_*`), generate `SELECT pgmq.create('queue_name');`
- **Decision point**: Migrate pending messages or just recreate empty queues?
- **Filter out**: Auto-created queue tables (created by extension functions)
- **Out of scope (CLI, optional)**: Migrating pending and archived messages; default is to recreate empty queues. Provide a CLI flag (e.g., `--include-pgmq-messages`) to copy queue contents when desired.

**vector (AI/Embeddings):**

- **DDL**: `CREATE EXTENSION vector WITH SCHEMA extensions;`
- **Data**: Vector embeddings in user tables (can be huge - need batching)
- **Indexes**: HNSW/IVFFlat indexes on vector columns
- **Performance**: Consider regenerating embeddings vs migrating
- **Out of scope (CLI, optional)**: Migrating large embeddings by default. The engine handles schema and indexes; use a CLI-controlled bulk copy (e.g., `--include-vector-data`) or regenerate embeddings out-of-band.

**pg_net (HTTP Client):**

- **DDL**: `CREATE EXTENSION pg_net;`
- **Data**: Custom HTTP configuration tables (if any)
- **Functions**: Migrate functions that call `net.http_post()`, etc.
- **Out of scope (CLI/system)**: Environment-specific HTTP endpoints and secrets. Use CLI templating/values to rewire URLs and credentials post-migration.

### 2. Authentication Schema (`auth`)

**What we need to handle:**

The `auth` schema is managed by Supabase's auth service but may have user customizations:

**Core Tables (never modify structure):**

- `auth.users`, `auth.identities`, `auth.sessions`, `auth.refresh_tokens`
- `auth.audit_log_entries`, `auth.schema_migrations`

**User Customizations (must migrate):**

- Custom triggers on auth tables (e.g., profile creation)
- Custom RLS policies on auth tables
- Functions that reference `auth.users` or `auth.jwt()`

**Critical Data:**

- `auth.schema_migrations` - Prevents auth service from re-running migrations
- User data - Usually NOT migrated (privacy/security)
- **Out of scope (CLI, flag-gated)**: Auth user PII and session/refresh data are excluded by default. Allow copying only in non-production via an explicit CLI flag (e.g., `--include-auth-data`).

### 3. Storage Schema (`storage`)

**What we need to handle:**

**Core Tables (structure managed by Supabase):**

- `storage.buckets` - Bucket configurations
- `storage.objects` - File metadata
- `storage.migrations` - Storage service migration history

**User Customizations:**

- RLS policies on `storage.objects` and `storage.buckets`
- Custom triggers on storage tables

**Data Migration:**

- Bucket configurations - Must migrate
- File metadata - Must migrate
- Actual files - Stored externally, need separate process
- **Out of scope (CLI/system)**: Actual file contents are in object storage; use a storage sync pipeline separate from the DB engine.
- **Out of scope (CLI, optional)**: Large-scale `storage.objects` metadata copies. Default to skip in production; provide a CLI flag (e.g., `--include-storage-objects`) to copy with batching when explicitly requested.

### 4. Realtime Schema (`realtime`)

**What we need to handle:**

**PostgreSQL Publications:**

- Default `supabase_realtime` publication - Auto-managed, don't migrate
- Custom publications - Must migrate
- Publication table memberships - Must recreate after tables exist

**Service State:**

- `realtime.schema_migrations` - Must migrate to preserve service state
- **Out of scope**: Active realtime subscriptions are ephemeral and not migrated.

### 5. Edge Functions

**What we need to handle:**

Edge functions are stored externally but have database dependencies:

**Database Functions:**

- Functions with `SECURITY DEFINER` that edge functions call
- Standard function migration

**Database Triggers:**

- Triggers that call edge functions via webhooks (using pg_net)
- Must update webhook URLs for new environment

**Permissions:**

- `GRANT EXECUTE ON FUNCTION func_name TO service_role;`
- **Out of scope (CLI/system)**: Edge function code, deployment configuration, and environment variables. Manage via `supabase functions` export/import and environment management. The engine only migrates DB-side dependencies (functions, triggers, grants).

### 6. Platform Schemas

**supabase_migrations:**

- `supabase_migrations.schema_migrations` - CLI migration history
- Critical for CLI compatibility

**pgsodium (if column encryption enabled):**

- Encryption keys - Must use Supabase API, never SQL dumps
- Encrypted columns - Standard migration but keys must exist first
- **Out of scope (CLI/system)**: Key migration is handled via Supabase API. The engine should block/emit a clear error if required keys are not present in the target.

Additionally, for service migration/history tables:

- **Out of scope (CLI-managed)**: `auth.schema_migrations`, `storage.migrations`, `supabase_functions.migrations`, and `supabase_migrations.schema_migrations` are copied verbatim by the CLI in the correct order. The engine does not diff or transform these tables.

## Implementation Plan

### Phase 1: Extension Detection and Migration

**Issues to create:**

1. **Extension Scanner** - Query `pg_extension` to detect installed extensions
2. **Extension Classifier** - Categorize as core/optional/system using CLI lists
3. **Extension DDL Generator** - Generate `CREATE EXTENSION` statements
4. **Extension Data Migrator** - Handle extension-specific data (cron jobs, queues)

### Phase 2: Schema-Specific Handlers

**Issues to create:** 5. **Auth Schema Handler** - Detect and migrate auth customizations 6. **Storage Schema Handler** - Migrate buckets, policies, metadata 7. **Realtime Schema Handler** - Handle publications and subscriptions 8. **Platform Schema Handler** - Migration history preservation

### Phase 3: Advanced Features

**Issues to create:** 9. **RLS Policy Migration** - Comprehensive policy handling 10. **Function Dependency Resolver** - Ensure correct migration order 11. **Publication Manager** - PostgreSQL publication handling 12. **Idempotent DDL Generator** - Use CLI's proven patterns

## Issues to Create

### Issue #1: Extension Detection and Classification

**Acceptance Criteria:**

- [ ] Query `pg_extension` catalog to detect all installed extensions
- [ ] Classify extensions as core/optional/system using CLI's lists
- [ ] Generate appropriate `CREATE EXTENSION` statements with correct schemas
- [ ] Handle extension dependencies and ordering

**E2E Test:**

```sql
-- Source DB has pg_cron, pgmq, vector
-- Target DB should have same extensions installed
select extname from pg_extension where extname in ('pg_cron', 'pgmq', 'vector');
```

### Issue #2: Cron Job Migration

**Acceptance Criteria:**

- [ ] Detect jobs in `cron.job` table
- [ ] Generate `SELECT cron.schedule()` calls
- [ ] Handle job dependencies on functions
- [ ] Preserve job schedules, commands, and active status

**E2E Test:**

```sql
-- Source has cron job that calls custom function
-- Target should recreate job after function exists
select jobname, schedule, command from cron.job where jobname = 'test_job';
```

### Issue #3: Message Queue Migration

**Acceptance Criteria:**

- [ ] Detect queue tables matching `pgmq_*` pattern
- [ ] Generate `SELECT pgmq.create()` calls
- [ ] Handle unlogged vs logged queues
- [ ] Option to migrate pending messages or create empty queues

**E2E Test:**

```sql
-- Source has queues 'notifications' and 'emails'
-- Target should recreate queues with same configuration
select queue_name from pgmq.list_queues() order by queue_name;
```

### Issue #4: Auth Schema Customization Migration

**Acceptance Criteria:**

- [ ] Detect custom triggers on auth tables
- [ ] Migrate custom RLS policies on auth tables
- [ ] Preserve `auth.schema_migrations` data
- [ ] Never modify core auth table structures

**E2E Test:**

```sql
-- Source has custom trigger on auth.users
-- Target should have same trigger
select trigger_name
from information_schema.triggers
where event_object_schema = 'auth' and event_object_table = 'users';
```

### Issue #5: Storage Configuration Migration

**Acceptance Criteria:**

- [ ] Migrate bucket configurations from `storage.buckets`
- [ ] Migrate file metadata from `storage.objects`
- [ ] Migrate custom RLS policies on storage tables
- [ ] Preserve `storage.migrations` data

**E2E Test:**

```sql
-- Source has custom bucket 'avatars' with size limit
-- Target should have same bucket configuration
select id, file_size_limit from storage.buckets where id = 'avatars';
```

### Issue #6: Realtime Publication Migration

**Acceptance Criteria:**

- [ ] Skip default `supabase_realtime` publication
- [ ] Migrate custom publications
- [ ] Recreate publication table memberships after tables exist
- [ ] Preserve `realtime.schema_migrations` data

**E2E Test:**

```sql
-- Source has custom publication for specific tables
-- Target should have same publication
select pubname, tablename
from pg_publication_tables
where pubname != 'supabase_realtime'
order by pubname, tablename;
```

### Issue #7: Vector Data Migration

**Acceptance Criteria:**

- [ ] Detect tables with vector columns
- [ ] Migrate vector embeddings with batching for performance
- [ ] Recreate vector indexes (HNSW/IVFFlat)
- [ ] Handle large vector datasets efficiently

**E2E Test:**

```sql
-- Source has documents table with vector embeddings
-- Target should have same vector data and indexes
select COUNT(*) from documents where embedding is not null;
select indexname from pg_indexes where tablename = 'documents' and indexdef like '%vector%';
```

### Issue #8: Migration History Preservation

**Acceptance Criteria:**

- [ ] Migrate `auth.schema_migrations`
- [ ] Migrate `storage.migrations`
- [ ] Migrate `supabase_functions.migrations`
- [ ] Migrate `supabase_migrations.schema_migrations`

**E2E Test:**

```sql
-- All service migration histories should be preserved
select COUNT(*) from auth.schema_migrations;
select COUNT(*) from storage.migrations;
select COUNT(*) from supabase_migrations.schema_migrations;
```

### Issue #9: Encryption Key Migration (pgsodium)

**Acceptance Criteria:**

- [ ] Detect if pgsodium extension is used
- [ ] Use Supabase API to migrate encryption keys securely
- [ ] Ensure encrypted data remains readable after migration
- [ ] Never expose keys in SQL dumps

**E2E Test:**

```bash
# Keys should be migrated via API, encrypted data should decrypt
curl "https://api.supabase.com/v1/projects/$NEW_PROJECT_REF/pgsodium" \
  -H "Authorization: Bearer $TOKEN"
```

### Issue #10: Reserved Role Protection

**Acceptance Criteria:**

- [ ] Never migrate CLI's reserved roles list
- [ ] Migrate only user-created roles
- [ ] Preserve role permissions and grants

**E2E Test:**

```sql
-- Should not find any reserved roles in migration output
select rolname
from pg_roles
where rolname in ('anon', 'authenticated', 'service_role', 'supabase_admin');
```

## End-to-End Acceptance Criteria

### Complete Migration Test

**Setup:**

- Source Supabase DB with: custom functions, cron jobs, vector data, storage buckets, auth triggers
- Empty target Supabase DB

**Success Criteria:**

- [ ] All extensions installed and configured
- [ ] All cron jobs recreated and functional
- [ ] All vector data migrated with indexes
- [ ] All storage buckets and policies migrated
- [ ] All auth customizations preserved
- [ ] All realtime publications working
- [ ] All service migration histories preserved
- [ ] No reserved roles migrated
- [ ] All DDL is idempotent (can run multiple times)

### Performance Test

- [ ] Vector data migration handles 1M+ embeddings efficiently
- [ ] Large storage.objects tables (1M+ files) migrate successfully
- [ ] Migration completes within reasonable time bounds

### Safety Test

- [ ] Failed migrations can be rolled back
- [ ] Auth functionality remains intact
- [ ] Storage access continues working
- [ ] No data corruption or loss

## Success Metrics

We'll know we've succeeded when:

1. **Functional**: All Supabase features work after migration
2. **Complete**: No manual post-migration configuration required
3. **Safe**: Migrations are reversible and don't break existing functionality
4. **Fast**: Large databases migrate in reasonable timeframes
5. **Reliable**: Migrations succeed consistently across different Supabase configurations
