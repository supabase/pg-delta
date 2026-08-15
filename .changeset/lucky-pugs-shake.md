---
"@supabase/pg-delta": patch
---

Add an opt-in bypass for the shadow-vs-target same-database identity refusal.

A physically restored shadow — a warm shadow cache rehydrated from a PGDATA
snapshot of the target cluster, as the Supabase CLI provisions — inherits the
target's `system_identifier` and every database OID, so the identity guard
cannot tell it apart from the target and refused to load declarative SQL,
blocking declarative sync whenever the shadow cache was on.

`planSchemaFiles` now accepts `allowSameDatabaseIdentity`, and `schema apply`
accepts `--allow-same-database-identity`, to proceed in that case; both emit a
loud warning naming what was bypassed. Default behavior is unchanged (the
refusal still fires), and both refusal messages now explain that physically
cloned shadows legitimately trigger the guard and name the escape hatch.
