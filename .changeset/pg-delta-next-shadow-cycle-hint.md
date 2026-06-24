---
"@supabase/pg-delta-next": minor
---

When a reordered `schema apply` load fails to converge, attach the reordering assist's statically-detected cycle members as a clearly-labeled, advisory hint on top of the (authoritative) Postgres errors — e.g. `Suspected shadow-load cycle: schema.sql:1:1 → schema.sql:2:1 → (back to schema.sql:1:1)`. This pinpoints unbreakable shadow-load cycles (such as an inline mutual foreign key) without the assist ever deciding the load failed — Postgres still elaborates the shadow (P1). New `analyzeForShadow(files)` returns the reordered files plus the detected `ShadowLoadCycle[]`; `orderForShadow` is now a thin wrapper over it. The hint is only added for genuinely non-converging loads (stuck / max-rounds), never for unrelated rejections.
