---
"@supabase/pg-delta": patch
---

`schema export` now co-locates indexes with their owning relation's file (the table's or materialized view's `.sql`, restoring the old engine's readable layout) — there is no `indexes/` directory anymore. A `CREATE INDEX CONCURRENTLY` (only rendered under the opt-in `concurrentIndexes` param) keeps its own file, since non-transactional statements must load alone. Satellite routing is also relation-kind-aware now: an `INSTEAD OF` trigger, rule, or comment targeting a **view** files under `views/<v>.sql` (matviews under `materialized_views/`) instead of a phantom `tables/<v>.sql`. The grouped layout's flat-schema collapse follows the co-location (indexes and view satellites stay in their relation's category file).
