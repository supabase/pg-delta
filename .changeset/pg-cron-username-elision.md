---
"@supabase/pg-delta": patch
---

Elide the default-owner username when replaying a pg_cron job, so a plan containing cron intent is applyable by a non-superuser executor.

pg_cron requires SUPERUSER for any non-NULL `username` argument to
`cron.schedule_in_database(...)` — even when it names the calling role itself
(`ERROR: must be superuser to create a job for another role`). A bare `NULL`
means `current_user` and needs no privilege. Because pg-delta always rendered
an explicit username literal, every plan or export containing a pg_cron job
was unapplyable as the `postgres` role a hosted Supabase project hands out.

The pg_cron handler is now a factory, `makePgCronHandler({ defaultJobOwner,
jobOwnerAliases })`, so the file carries no platform-specific role names; the
Supabase profile constructs it with `defaultJobOwner:
supabasePolicy.defaultOwner` and the CLI-1435 `supabase_read_only_user →
postgres` alias. A job owned by the profile's default job owner replays with
`NULL`; a job owned by a third role keeps the explicit literal (it genuinely
requires a superuser executor) and now raises a new `intent-privileged`
warning diagnostic at capture — warn and emit, never silently drop.

A custom profile file (`--profile ./my-profile.json`) gets the same treatment:
its `handlers: ["pg_cron"]` entry is built from the file's OWN
`policy.defaultOwner`, so a profile that declares an owner/executor role also
gets the elision. Only profiles with no declared default owner (`raw`, and
profile files without `policy.defaultOwner`) keep the explicit rendering.
