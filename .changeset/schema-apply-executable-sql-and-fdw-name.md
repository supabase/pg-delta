---
"@supabase/pg-delta-next": patch
---

fix(pg-delta-next): require executable SQL for schema apply; create export root for empty exports; keep FDW names out of CREATE SERVER clause scans

- `schema apply` now refuses a `--dir` with no EXECUTABLE SQL, not just zero
  filenames: a placeholder/comment-only `.sql` still yields an empty shadow and a
  plan that drops every managed object. It requires at least one real SQL token
  (`scanTokens` skips comments/strings) and aborts (exit 2) otherwise (#3505497725).
- `schema export` creates the output root up front (via a new `writeExportFiles`
  helper) so a database with no managed objects (zero files) writes its
  `.pgdelta-export.json` manifest instead of throwing ENOENT (#3505497730).
- The SQL formatter's `CREATE SERVER` clause scan now skips the FDW name after
  `FOREIGN DATA WRAPPER`, so an unquoted non-reserved name such as
  `FOREIGN DATA WRAPPER options` is no longer misread as an `OPTIONS` clause
  (which dropped the wrapper name and produced invalid SQL) (#3505497733).
