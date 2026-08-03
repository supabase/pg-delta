---
"@supabase/pg-delta": patch
---

Stop exporting and dropping the platform-provided `supabase_realtime` publication under `--profile supabase` (#370).

The Supabase platform creates the `supabase_realtime` publication at project init (owned by `postgres`, so no owner- or schema-based policy rule catches it). Users manage its membership — `ALTER PUBLICATION supabase_realtime ADD TABLE …` is the documented way to enable Realtime on a table — but never the publication object itself. pg-delta previously treated the whole publication as user state:

- `schema export` rewrote it as `CREATE PUBLICATION supabase_realtime FOR TABLE …`, which is not replayable (the publication already exists on every Supabase database).
- `schema apply` with declarative files that (correctly) omitted the publication planned a destructive `DROP PUBLICATION supabase_realtime`, which would break Realtime.
- A membership-only declarative dir could not load into the co-located shadow at all (`ALTER PUBLICATION` referenced a publication the fresh shadow lacked).

The Supabase policy now declares `supabase_realtime` as an **assumed publication** (a new `Policy.assumedPublications` field mirroring `assumedRoles` / `assumedSchemas`): the publication object is kept reference-only in the managed view — never created, dropped, or altered — while its membership facts stay fully managed and diff at rel grain. Export emits `ALTER PUBLICATION supabase_realtime ADD TABLE …` into `cluster/publications.sql`, apply leaves the publication itself untouched, and the co-located shadow seed materializes it (empty) so membership-only files load — including for custom profiles whose only assumed objects are publications. Comment / security-label satellites targeting a platform publication are excluded like other platform metadata (mirroring the existing system-schema satellite rule), so a platform-set comment absent from user files is never nulled out. `supabase_realtime_messages_publication` (Realtime broadcast-from-database, no user-manageable membership) is excluded outright. User-created publications — including their comments — are unaffected.

Note: a declarative dir exported by an earlier version may still contain `CREATE PUBLICATION supabase_realtime …`; loading it now fails loudly with "publication already exists" — remove the statement (keeping any `ALTER PUBLICATION … ADD TABLE` lines) or re-export.
