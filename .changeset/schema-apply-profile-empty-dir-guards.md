---
"@supabase/pg-delta-next": patch
---

fix(pg-delta-next): stamp export profile, refuse empty schema-apply dir, normalize --dir names

- `schema export` now records the projection profile in `.pgdelta-export.json`,
  and `schema apply --dir` defaults to it (rejecting a contradicting `--profile`
  up front via the same reconciliation as plan artifacts). Previously a
  `schema export --profile supabase` directory applied under the default (raw)
  profile read the target's platform schemas/roles as drift and could plan
  destructive drops of platform state (#3505238081).
- `schema apply` now aborts (exit 2) when `--dir` contains no `.sql` files, rather
  than loading an empty shadow and planning to drop every managed object on the
  target — a wrong/empty `--dir` is a loud error, not a silent destructive plan
  (#3505238083).
- `collectSqlFiles` derives relative names from the normalized root
  (`relative(resolve(dir), full)`) instead of slicing the raw `--dir` string, so
  a trailing slash no longer drops the first character of every file name and
  corrupt the raw loader's lexicographic order.
