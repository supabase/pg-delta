---
"@supabase/pg-delta": patch
---

fix(pg-delta): replay pg_cron database/username/active via schedule_in_database

The pg_cron job intent captures a job's `database`, `username`, and `active`
fields, but the replay emitted the 3-arg `cron.schedule(name, schedule, command)`
form, which always (re)creates the job in the current database, active, owned by
the executing user. A job that was inactive, targeted another database, or had a
non-current username therefore never converged. The create rule now emits the
6-arg `cron.schedule_in_database(name, schedule, command, database, username,
active)` so all captured fields replay deterministically. The signature has been
stable since pg_cron 1.4, which every supported PostgreSQL image (and the
supabase/postgres image) ships.
