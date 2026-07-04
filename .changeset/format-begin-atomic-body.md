---
"@supabase/pg-delta-next": patch
---

Fix `schema export --format-options` producing invalid SQL for SQL-standard (`BEGIN ATOMIC … END`) function and procedure bodies. The pre-format statement splitter broke those bodies on their bare, unquoted internal semicolons, emitting one `CREATE FUNCTION` as several fragments each terminated with its own `;`. The splitter is now aware of `BEGIN ATOMIC … END` (and nested `CASE … END`) blocks and keeps the routine as a single statement.
