---
"@supabase/pg-delta": patch
---

Render `ALTER ROLE … SET search_path` as one string literal per list element (`TO 'public', 'extensions', 'realtime'`). A single quoted string collapsed a multi-schema path into one schema name, and an empty path emitted the invalid identifier `""`.
