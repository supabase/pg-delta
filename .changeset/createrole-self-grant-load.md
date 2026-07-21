---
"@supabase/pg-delta": patch
---

`loadSqlFiles` enables `createrole_self_grant` on PG 16+ so a CREATEROLE non-superuser (Supabase `postgres`) can load `CREATE SCHEMA … AUTHORIZATION new_role`, and strips the resulting bootstrap memberships from the extracted fact base so plans do not emit a failing `GRANT … TO <applier> WITH ADMIN OPTION`. Assumed-schema seeding uses the same GUC on a dedicated pool client.
