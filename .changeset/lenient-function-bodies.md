---
"@supabase/pg-delta": minor
---

`schema apply` (and the `loadSqlFiles` loader) now treat a USER routine whose body fails the post-load `check_function_bodies = on` re-validation as a loud WARNING instead of a fatal error. Postgres itself accepts such a function under `check_function_bodies = off` — which pg-delta's own apply executor emits in every plan preamble — so refusing to READ back a function pg-delta would happily WRITE was an asymmetry that blocked round-tripping any schema relying on check-off (legacy forward references, tolerated casts, etc.). The warning still flows through the diagnostics output loudly; the load now proceeds and apply faithfully materializes exactly what was declared. Pass `--strict-function-bodies` (loader option `strictFunctionBodies: true`) to restore the fatal gate for CI.

Seeded/reference-only routine failures are unchanged (still a warning) and now carry the distinct `invalid_seeded_routine_body` code so they can be told apart from user-routine failures. Changing an assumed-schema routine (a new overload, or a `CREATE OR REPLACE` that alters the body of a seeded routine) still fails loud, because assumed-schema facts are reference-only in the diff and such a change would otherwise be a silent no-op.
