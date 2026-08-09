---
"@supabase/pg-delta": patch
---

fix(pg-delta): merge case-colliding schema export paths into one shared file

PostgreSQL identifiers are case-sensitive, but the default filesystems on
macOS (APFS) and Windows (NTFS) are not: case-twin objects (`"Users"` vs
`"users"`) exported to paths differing only by case landed in one physical
file, the second write silently overwrote the first, and `schema apply` from
that directory wedged on the missing object's dependents. `schema export` now
folds every case-colliding path segment to a canonical spelling — the
lexicographically smallest spelling actually present — on every platform, so
an export written on Linux still checks out cleanly on a Mac: case-twin files
merge into one shared file holding every twin's DDL in plan order, and
descendants of case-twin directories agree on the parent's casing. Dependency
cycles that only exist at the merged-file grain are handled so the loader
still converges: foreign keys route to the `.fk.sql` post-data split, and
unsplittable cycles (case-twin views around an interposed view) collapse into
one file.

Identifiers containing dots now percent-encode them in export file names
(a table `"Foo.fk"` exports as `Foo%2Efk.sql`), so an identifier can never
spoof the reserved `.sql` / `.fk.sql` suffixes; over-long encoded names clamp
deterministically under the 255-byte filename limit. A lone spelling is never
rewritten, non-colliding paths are unchanged, and each merge is reported as
an export warning.
