---
"@supabase/pg-delta": patch
---

Fix `schema apply --profile ...` at the default `database` scope wrongly planning to DROP platform objects owned by system roles (e.g. `DROP EVENT TRIGGER` owned by `supabase_admin`). Apply now resolves the policy managed view BEFORE projecting the management scope out — the same order `schema export` uses — so a policy's owner-exclusion rule still sees the `owner` edges that `projectManagementScope("database")` would otherwise strip. The scope projection is applied as the single managed-view-under-scope definition in the planner, the apply fingerprint gate, and the proof loop, preserving `plan == prove == run`.
