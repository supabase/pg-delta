---
"@supabase/pg-delta-next": minor
---

`schema apply` now runs the statement-reordering assist by default: SQL files are split into one-statement units and topologically pre-sorted before loading into the shadow, so authoring order *within* a file no longer matters (a `CREATE VIEW` before its `CREATE TABLE` in the same file, or an inline FK split into a separate `ALTER TABLE`, now converges instead of getting stuck at file granularity). Pass `--no-reorder` to reproduce the raw file-granular behavior for debugging. When a reordered load gets stuck, the loader's synthetic ordinal file names are rewritten back to the real authored location (`schema/users.sql:line:col`) in the error, with the Postgres message preserved verbatim.
