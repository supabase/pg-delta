---
"@supabase/pg-delta": patch
---

Fix `extract()` failing with `permission denied for table pg_user_mapping` when connecting as a non-superuser: user mappings now fall back to the world-readable `pg_user_mappings` view (with a warning diagnostic, since the view hides options the role isn't authorized on). Mappings whose options the view hides from the current role are skipped with that diagnostic instead of being recorded with fabricated empty options. `plan()` now refuses to plan changes touching a user mapping whose state was unreadable (and therefore unknown) on either side, instead of silently emitting a wrong CREATE/DROP USER MAPPING.

The unreadable-user-mapping diagnostic now survives extension-handler profiles (e.g. Supabase) instead of being silently dropped by the handler-triggered fact-base rebuild. Snapshots now carry `FactBase.diagnostics` (excluded from the digest), so the `plan()` gate still fires when one side is a deserialized snapshot rather than a live extraction; old snapshots without this field simply remain ungated, same as before. The gate itself now also refuses a `DROP SERVER` or `DROP ROLE` that would implicitly destroy a hidden mapping, not just a direct change to the mapping itself.

`pgdelta drift` now surfaces diagnostics carried by the snapshot side; the plan gate also covers replace-class server changes (`server.type`/`server.fdw`, which have no in-place ALTER and would otherwise silently drop-and-recreate the server, destroying an unreadable mapping's server, instead of throwing).

`pgdelta prove` now surfaces diagnostics carried by the desired snapshot and annotates a passing proof with their count.
