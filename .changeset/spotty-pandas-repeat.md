---
"@supabase/pg-delta": minor
---

`pgdelta schema export` now reports a per-file change summary — the final
`Exported N file(s) ...` line includes how many files were created, updated,
and unchanged (stale removals were already reported). Byte-identical files are
no longer rewritten, so their mtimes stay stable for build tools watching the
output directory. `writeExportFiles` returns the classification as `created` /
`updated` / `unchanged` alongside the existing `removed` / `unmanaged` lists.
