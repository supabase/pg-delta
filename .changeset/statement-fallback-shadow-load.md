---
"@supabase/pg-delta": patch
---

`loadSqlFiles` / `planSchemaFiles` now fall back to per-statement apply when a file cannot commit atomically (`statementFallback` defaults to on). Pass `false` to restore whole-file rollback. `LoadResult.splitFiles` names files demoted this load.
