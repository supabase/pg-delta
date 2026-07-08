---
"@supabase/pg-delta": patch
---

`schema apply`'s statement-reordering assist no longer disables itself for **exported** directories containing `ALTER DEFAULT PRIVILEGES`. The conservative bail exists because ADP applies to objects created after it in authored order — for a hand-authored directory the interleaving is semantics the assist must not change, and that behavior is unchanged. But a directory produced by `schema export` (identified by its `.pgdelta-export.json` manifest) never relies on implicit ADP grants: the exporter emits explicit per-object `REVOKE`/`GRANT` for every object, so ADP position is irrelevant there. Exported dirs now keep statement-granular loading (with pg-topo installed), so cross-file orderings that file-granular retry cannot resolve converge instead of getting stuck.
