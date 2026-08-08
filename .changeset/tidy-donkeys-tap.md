---
"@supabase/pg-delta": patch
---

Plan ordering: actions that evaluate user expressions at apply time (column defaults, generated columns, CHECK validation, expression indexes, materialized-view population) are now scheduled after all ready definition actions, so opaque quoted routine bodies can resolve their helpers. An action counts as evaluating whenever a routine is *reachable* from the expression's recorded structure — including indirectly, e.g. a materialized view that selects from a view which calls the routine, or a column whose domain type carries a CHECK that calls it.
