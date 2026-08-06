---
"@supabase/pg-delta": minor
---

The shadow loader's post-load DML observation no longer fails a load, and a pre-provisioned isolated shadow is now supported.

`loadSqlFiles` used to throw `ShadowLoadError` as soon as ANY managed non-extension table held rows after loading the declarative files. That blocked callers whose dedicated shadow is pre-provisioned by a platform — the Supabase CLI boots auth / storage / realtime against its isolated shadow, and those services write their own migration bookkeeping rows (`auth.schema_migrations`, `storage.migrations`, `_realtime.tenants`, …) BEFORE any declarative SQL is loaded. Those rows are not the user's DML and there is nothing the user can do about them.

Two changes:

- **Pre-existing rows are exempt.** New loader option `allowPreExistingRows` (default: `true` in `"isolatedCluster"` mode, `false` otherwise; `planSchemaFiles` forwards it and lets the loader default it). When enabled the loader snapshots WHICH managed non-extension tables are already populated before the load and exempts exactly those from the post-load observation — silently, with no diagnostic. The exempted set is returned as `LoadResult.preExistingPopulatedTables`. Exemption is by qualified table name and never compares row contents (the loader deliberately does not diff data), so a table that was already populated stays exempt even if a declarative file inserts into it.
- **Rows the load DID introduce are a warning, not a failure.** A non-exempt populated table now appends a `data_statement` diagnostic with severity `warning` to `LoadResult.diagnostics` and the load proceeds: pg-delta only ever diffs schema, so incidental data in the shadow cannot corrupt a plan, and refusing to read the schema back would block every directory that carries some. Pass `--strict-data-statements` (loader option `strictDataStatements: true`, `planSchemaFiles` option of the same name) to restore the previous fatal `ShadowLoadError` for CI.

Extension-owned relations (`pg_depend` deptype `'e'`) remain out of scope, exactly as before.
