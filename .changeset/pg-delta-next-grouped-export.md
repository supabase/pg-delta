---
"@supabase/pg-delta-next": minor
---

Add `schema export --layout grouped`, restoring the old engine's "nice" declarative export. Files are ordered by a fixed semantic category (cluster → schema → types → tables → views → …) instead of raw plan order, and statements within a file are sorted for readability (create → alter, object → comment → privilege → …). Opt-in grouping is available via `--grouping-mode single-file|subdirectory`, `--group-patterns '[{"pattern":"^auth_","name":"auth"}]'` (first match wins), `--flat-schemas <csv>` (collapse a schema to one file per category), and `--no-group-partitions` (partition children otherwise group into their parent's file). The default `by-object` and `ordered` layouts are unchanged, and `load(export(fb, "grouped")) ≡ fb` fidelity still holds. SQL formatting options (keywordCase/maxWidth) from v1 are intentionally not ported — v2 renders SQL from the fact base and does not normalize SQL text.
