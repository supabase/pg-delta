---
"@supabase/pg-delta-next": patch
---

`schema apply` no longer silently degrades the shadow state when the default statement-reordering assist is unsafe. It now falls back to raw, file-granular loading (the `--no-reorder` behavior) with a warning when either: a directory's file triggers a `pg-topo` parse / discovery error (which would otherwise drop that file's statements and plan destructive changes against a partial desired state), or a file contains session-setting statements (`SET search_path` / `SET ROLE` / `SET SESSION AUTHORIZATION`, which `pg-topo` may reorder relative to the DDL they scope).
