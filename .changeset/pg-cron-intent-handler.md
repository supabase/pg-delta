---
"@supabase/pg-delta-next": minor
---

Add pg_cron intent support (extension-intent §3.2). A new generic `extensionIntent` fact kind lets stateful-extension state be diffed as ordinary facts, and the bundled `pgCronHandler` captures `cron.job` rows as intent facts keyed by jobname. A schedule/command change now plans as `select cron.unschedule('<name>')` + `select cron.schedule('<name>', …)` (by name, no runtime jobid); a removed job plans as `cron.unschedule`. Job replay rules are resolved per-plan from the active profile's handlers (never mutated into the global rule table), and order after all schema DDL. Unnamed or duplicate-named jobs cannot be keyed: on the source side they are surfaced as a warning and left unmanaged, and on the desired side `plan()` fails loudly rather than emit a migration that can never converge. `supabaseProfile` now composes `pgCronHandler` alongside `pgPartmanHandler`.
