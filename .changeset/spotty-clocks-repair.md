---
"@supabase/pg-topo": patch
---

Slice statements by UTF-8 byte offsets so SQL containing non-ASCII text is carried verbatim. libpg_query reports `stmt_location`/`stmt_len` in bytes, but statements were sliced with UTF-16 string indices — any non-ASCII content misaligned the slice and silently swapped the authored text for a deparse fallback that renders `COMMENT ON TRIGGER/POLICY/RULE` targets as invalid dotted names (e.g. `COMMENT ON TRIGGER public.t.tr`). `sourceOffset` is now a character offset (it was a byte offset consumed as a character index by downstream line:column rendering), and a deparse fallback that fails to re-parse now surfaces a `PARSE_ERROR` diagnostic instead of returning invalid SQL.
