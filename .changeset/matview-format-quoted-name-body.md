---
"@supabase/pg-delta-next": patch
---

Fix two `schema export --format-options` bugs for materialized views:

- A quoted / schema-qualified name (`"s"."v"`) was skipped by the tokenizer, so the storage `WITH (...)` clause (and the name) were dropped. The formatter now locates the qualified name from the raw statement (quote-aware).
- With `preserveViewBodies:false` the SELECT body is unprotected, and the scanner treated every `AS` (column alias) / `WITH` (`WITH NO DATA`, CTEs) inside it as a matview clause, shredding the query. The formatter now falls back to generic formatting when the body is not protected.
