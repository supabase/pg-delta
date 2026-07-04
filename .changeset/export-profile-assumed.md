---
"@supabase/pg-delta-next": patch
---

Fix `schema export --profile <p>` crashing with `missing requirement: … consumes schema:extensions …` (or an assumed role) when the managed view keeps an action targeting an assumed-but-filtered object — for example a relocatable extension in the platform `extensions` schema, or a `GRANT … TO anon`. The export now forwards the profile's `assumedSchemas` / `assumedRoles` to its internal plan, matching the DB-to-DB `plan --profile` path. `plan()` also accepts `assumedSchemas` / `assumedRoles` directly (supplementing those derived from a `policy`) for callers that already hold a resolved managed view.
