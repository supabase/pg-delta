---
"@supabase/pg-delta": minor
---

Planning now pre-flights the gap the reserved `_custom/` folder creates. Raw SQL
— managed and custom alike — executes only in the disposable shadow, so the
shadow can hold unmodeled objects (casts, operators, text-search objects, …) the
target has never received; because unmodeled kinds produce no facts, the diff is
blind to them and no planned statement can create them, yet a generated statement
depending on one fails on the target. `planSchemaFiles` (and hence `schema apply`,
including `--dry-run`) now probes both catalogs and emits one `unmodeled_drift`
warning per kind the shadow has and the target lacks, listing the missing
identities — printed under the `[drift]` label, carried on the new
`PlanSchemaFilesResult.driftDiagnostics`, and blocking under
`--strict-coverage`. It is catalog-sourced only: nothing parses SQL, and the
reverse direction (target extras) is deliberately not reported.

Two frontend seams ship alongside it, for tools that own the migration channel
and can automate delivery instead of asking the user to. The new
`listCustomFiles(root)` returns every `_custom/**/*.sql` with its body and its
parsed `-- pgdelta-migration:` directives plus a `delivered` flag (a recorded
migration, or an explicit `none`), so a frontend can fold the undelivered files
into the catch-up migration it already generates and stamp the directive back —
run-once semantics come from its own migration ledger, and pg-delta still
executes nothing against a target. And `schema lint` gains
`--custom-migration-refs warn|off` (default `warn`), where `off` silences
`custom_missing_migration_ref` alone for exactly those frontends; the dangling and
conflicting rules are never suppressible, because a recorded-but-wrong reference
is a bug whoever wrote it.
