---
"@supabase/pg-delta": minor
---

`schema export` now reserves a `_custom/` directory at the root of the export
tree: it is never written into, never pruned (not even with
`--prune-unmanaged`), never counted as an unmanaged file (so a re-export no
longer refuses on it), and never recorded in `.pgdelta-export.json`. It is the
durable home for SQL pg-delta detects but does not model (casts, operators,
text-search objects, … reported as `unmodeled_kind`) and for idempotent DML —
`schema apply` already loads it into the shadow, so a modeled object depending
on an unmodeled prerequisite (an index over a custom text search configuration,
say) elaborates again. Its files are never executed against the target; deliver
them through your normal migration channel, optionally recorded per file with a
head-of-file `-- pgdelta-migration: <path>` (or `none`) comment. On export a
`_custom/README.md` documenting the contract is scaffolded once, `schema lint`
gains four warnings (`custom_missing_migration_ref`,
`custom_dangling_migration_ref`, `custom_conflicting_migration_ref`,
`custom_modeled_kind`), and the `unmodeled_kind` diagnostic now points at the
folder.
