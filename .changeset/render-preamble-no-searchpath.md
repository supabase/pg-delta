---
"@supabase/pg-delta": patch
---

Rendered migration files no longer pin `search_path` in their preamble. The
rendered DDL is already fully schema-qualified, so the pin was redundant — and
it broke third-party migration runners such as dbmate, which append their own
unqualified bookkeeping (`INSERT INTO schema_migrations ...`) inside the same
transaction as the migration file; a pinned `search_path = pg_catalog` resolved
that insert to `pg_catalog.schema_migrations` (which does not exist) and failed
the migration. `check_function_bodies = off` is still emitted, and `apply()`
keeps pinning `search_path` on its own dedicated connection.
