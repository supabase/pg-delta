---
"@supabase/pg-delta": patch
---

fix(pg-delta): exclude Supabase default privileges declared FOR a system role from the managed view

`schema export --profile supabase` was emitting `ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" …` statements. A real Supabase user connects as `postgres` (a non-superuser) and can never execute an ADP declared FOR another role — that requires membership in the reserved role — so these statements made the export unappliable and polluted round-trips. The `supabase` policy now excludes default-privilege facts whose FOR-role is a system role, mirroring the existing owner-based exclusion for other object kinds. ADP declared FOR ROLE `postgres` (the user-owned API-role default) is unaffected regardless of which role is the grantee.
