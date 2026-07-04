---
"@supabase/pg-delta-next": patch
---

Fix `apply` failing with `constraint "…" already exists` (and similar) when an object that inlines child facts on CREATE (a domain with a validated CHECK, a partitioned table's columns) is REPLACED. The replacement path recreated surviving descendants separately even when the replacement CREATE had already materialized them via `alsoProduces`, emitting both `CREATE DOMAIN … CONSTRAINT …` and a duplicate `ALTER DOMAIN … ADD CONSTRAINT …`. The recreate loop now skips children already produced by the replacement create, mirroring the added-create loop.
