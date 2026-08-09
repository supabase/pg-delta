---
"@supabase/pg-delta": patch
---

CLI commands are now embedder-safe: command handlers (`schema apply`, `apply`, `drift`, `render`, `prove`, …) and the shared frontends/diagnostics helpers no longer call `process.exit` themselves. They throw instead (`UsageError` / `SchemaFrontendError` → exit 2, or `CliExit(code)` for operation-result exits), and `main()` is the sole exiter mapping those to the same CLI exit codes as before. Previously a guard such as the `schema apply` baseline-mismatch / pg_cron precheck aborted the host process mid-run when the command was invoked in-process (library use, tests), tearing everything down; those errors now propagate to the caller.

Extraction no longer emits owner edges to built-in (`pg_`-prefixed) roles such as `pg_database_owner` (the owner of the `public` schema). Those edges were always pruned as dangling, so the fact base is unchanged — this only removes the recurring `WARNING [dangling_edge] role:pg_database_owner` noise.
