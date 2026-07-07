---
"@supabase/pg-delta-next": minor
---

`--profile` now accepts a path to a custom profile `.json` file in addition to the built-in `raw`/`supabase` ids (a value is treated as a path when it contains `/` or ends in `.json`). The file mirrors an `IntegrationProfile` but references bundled handlers by name — `{ "id": "...", "handlers": ["pg_partman", "pg_cron"], "policy"?: { … } }` — so a consumer can compose exactly the extension handlers it needs without adding a built-in profile to the CLI. Unknown handler names and malformed files fail with a clear usage error. `apply`/`prove` reconcile a file-path `--profile` against the id the plan artifact stamped (load the file, compare its declared id).
