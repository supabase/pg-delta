---
"@supabase/pg-delta-next": patch
---

Fix planning under the Supabase profile crashing with `missing requirement: … consumes schema:extensions …` whenever a relocatable extension is installed into a managed schema (`CREATE EXTENSION … SCHEMA extensions`). Policies can now declare `assumedSchemas` — schemas assumed to exist at apply time but kept out of the managed view (Supabase's `extensions`, `auth`, etc.). The planner treats them like `assumedRoles` / `pg_*` / `PUBLIC`, so a `consumes schema:<name>` edge is accepted instead of being rejected as a stranded requirement, without re-admitting the schema into the diff.
