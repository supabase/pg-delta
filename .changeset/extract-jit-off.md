---
"@supabase/pg-delta": patch
---

Disable JIT for extraction's catalog queries. `EXPLAIN (ANALYZE)` on the `pg_depend` dependency-resolver query showed an inflated cost estimate crossing Postgres's default `jit_above_cost`, JIT-compiling ~467 functions per run for ~59% of a warm execution — pure per-execution overhead, since catalog-only queries gain nothing from JIT. Extraction now pins `SET LOCAL jit = off` for its transaction.
