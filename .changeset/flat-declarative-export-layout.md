---
"@supabase/pg-delta": minor
---

Flatten the default declarative-export tree.

`schema export` now writes one directory **per schema at the root** of the
output directory and puts the cluster-level files under `_cluster/`:

```text
schema/
  _cluster/roles.sql
  app/schema.sql
  app/tables/users.sql
```

Previously those paths were `schemas/app/tables/users.sql` and
`cluster/roles.sql`. Nothing below the root segment changed, and the loader is
structure-agnostic, so `schema apply --dir` and `load(export(db)) ≡ db` are
unaffected — but a re-export into an existing directory will move every file.

- Pass `pathStyle: "nested"` (library) or `--path-style nested` (CLI) to keep
  the previous paths.
- `pathStyle` composes with every `layout` (`by-object`, `ordered`, `grouped`).
  Under `ordered` the flattened file names get correspondingly shorter
  (`0001_app_tables_users.sql`).
- A schema named `_cluster` or `_custom` — the two directories the export tree
  reserves at its root — or any case variant of one escapes its leading
  underscore (`%5Fcluster/`, `%5FCUSTOM/`) so it can never claim, or case-fold
  into, one of them on a case-insensitive filesystem.
