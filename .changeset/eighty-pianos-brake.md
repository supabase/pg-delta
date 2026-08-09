---
"@supabase/pg-delta": patch
---

`schema apply` no longer corrupts `COMMENT ON TRIGGER`/`COMMENT ON POLICY` statements containing non-ASCII text during shadow-load reordering. The underlying fix lands in `@supabase/pg-topo` (statements are now sliced by UTF-8 byte offsets and carried verbatim); pg-delta picks it up through its optional peer range and adds regression coverage across the reorder → shadow-load path. Reordered error locations (`file:line:col`) are also exact after non-ASCII content, since `sourceOffset` is now a character offset.
