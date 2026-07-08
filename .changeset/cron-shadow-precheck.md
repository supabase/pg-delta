---
"@supabase/pg-delta": patch
---

`schema apply` now fails early with a clear message when a declarative directory contains `pg_cron` intent (`cron.schedule*` / `unschedule` / `alter_job`) but the shadow database can't execute it — pg_cron's schedule functions run only in the cluster's `cron.database_name`, which an auto-created co-located shadow never is. Previously the load reached the `cron.schedule_in_database(...)` statement and died with a confusing mid-load "function does not exist" stuck error. Extension handlers gained an optional `shadowPrecheck` contract for this (generic — pg_partman / pgmq don't define one); the remedy is to apply from a cluster whose shadow IS the cron database (`--shadow`) or exclude cron intent from the managed view.
