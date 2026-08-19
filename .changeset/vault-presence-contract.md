---
"@supabase/pg-delta": minor
---

Encode the supabase_vault presence-only contract (CLI-1434).

The generic path already plans CREATE/DROP EXTENSION supabase_vault. This
adds a raw-profile shadow precheck so alpine shadows fail early on
`vault.create_secret` / `CREATE EXTENSION supabase_vault`, and a plan-time
`vault_presence` warning when vault is in use (catalog dependents, never
secret rows) or is being dropped. Warnings block only under
`--strict-coverage`. The supabase profile still filters vault as platform
state.
