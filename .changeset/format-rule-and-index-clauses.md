---
"@supabase/pg-delta-next": patch
---

Fix three more `schema export --format-options` cases that produced invalid or semantically-different SQL:

- Multi-command rewrite-rule bodies (`CREATE RULE … DO ALSO ( INSERT …; UPDATE … )`) were split on the semicolons inside their parentheses. `splitSqlStatements` now also suppresses splitting at parenthesis depth > 0.
- A unique index's `INCLUDE (…)` list lost its closing paren when a `WHERE` / `WITH` / `TABLESPACE` clause followed (an offset was computed against the trimmed remainder).
- An index's `NULLS NOT DISTINCT` modifier was dropped when such a clause followed; the modifier text before the first recognized clause is now kept on the header line.
