---
"@supabase/pg-delta": patch
---

Scope post-load routine body-validation leniency to the routines the Phase 2b assumed-schema seed actually created, by full overload-safe identity and unchanged body — instead of by schema name. A user-authored routine in an assumed/seeded schema (e.g. a broken function in `auth` on a Supabase quick apply), a new overload of a seeded routine name, or a `CREATE OR REPLACE` that changes a seeded routine's body now fails loudly again rather than merely warning and being silently never applied.
