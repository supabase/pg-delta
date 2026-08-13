---
"@supabase/pg-delta": minor
---

`pgdelta schema export` now reports a per-file change summary — the final
`Exported N file(s) ...` line includes how many files were created, updated,
and unchanged (stale removals were already reported). Byte-identical files —
including the `.pgdelta-export.json` manifest — are no longer rewritten, so
mtimes across the output directory stay stable for build tools watching it.
`writeExportFiles` returns the classification as `created` /
`updated` / `unchanged` alongside the existing `removed` / `unmanaged` lists.
