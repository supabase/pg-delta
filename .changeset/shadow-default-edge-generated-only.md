---
"@supabase/pg-delta-next": patch
---

Fix `schema apply` / planning throwing a spurious `missing requirement` when a policy filters a column default. Extraction shadowed every `pg_attrdef` dependency onto the owning column, but an ordinary default is its own fact (which already carries the dependency and is inlined into the column's CREATE). When a policy filtered the default add, the column was emitted without it, yet the unprojected shadow edge still made the planner require the default's referenced object. The shadow edge is now emitted only for generated columns (which have no default fact and need it for ordering); ordinary defaults rely on their own `default → referenced` edge.
