---
"@supabase/pg-delta-next": patch
---

fix(pg-delta-next): export baseline seeding — reference-only parents and public-schema customizations

`exportSqlFiles` renders `plan(baseline, fb)` from a pristine baseline. Two gaps
in what that baseline seeded:

- It copied `public`'s **current** acl/comment into the baseline, so a customized
  `public` schema (`REVOKE CREATE ON SCHEMA public FROM PUBLIC`, a changed
  `COMMENT`) diffed to nothing and was dropped from the export — replaying into a
  fresh database silently kept the default privileges/comment. The baseline now
  seeds only `public`'s existence (still suppressing an unreplayable
  `CREATE SCHEMA public`); its acl/comment diff like every other schema's and are
  exported.
- It did not seed `referenceOnly` facts, so a managed object kept under a
  reference-only platform parent — e.g. a user trigger on `auth.users` under
  `--profile supabase` — threw `missing requirement` (its parent was neither in
  the baseline nor produced). `diff`/`plan` never consult `referenceOnly` (the
  DB-to-DB path relies on both sides carrying those facts); the from-pristine
  export has no such symmetry, so `referenceOnly` facts are now seeded into the
  baseline. The kept child exports and the assumed parent is not recreated.
