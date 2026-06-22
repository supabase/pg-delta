---
"@supabase/pg-delta-next": patch
---

Fix planning under the Supabase profile crashing with `missing requirement: … consumes role:anon …` whenever a managed schema grants to a platform role. Policies can now declare `assumedRoles` — roles assumed to exist at apply time but kept out of the managed view (Supabase's `anon`, `authenticated`, etc.). The planner treats them like `pg_*` / `PUBLIC`, so `GRANT … TO anon` and `ALTER DEFAULT PRIVILEGES … TO anon` are emitted instead of being rejected as stranded requirements, without re-admitting the roles into the diff.
