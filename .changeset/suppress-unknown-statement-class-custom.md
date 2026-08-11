---
"@supabase/pg-delta": patch
---

`pgdelta schema lint` no longer emits `UNKNOWN_STATEMENT_CLASS` for statements inside the reserved `_custom/` directory, since that folder is the documented home for SQL pg-delta does not model (casts, operators, text-search objects, ...); the warning still fires everywhere else, and `custom_modeled_kind` still catches modeled DDL mistakenly parked in `_custom/`.
