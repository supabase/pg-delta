---
"@supabase/pg-delta": minor
---

Canonicalize the extraction session's `search_path` to `pg_catalog` (pg_dump
convention). Postgres deparsers (`format_type`, `pg_get_*def`, `pg_get_expr`)
path-relativize names, so any object visible on the session path previously came
back UNQUALIFIED — meaning the same catalog extracted under different search_paths
(e.g. a target database carrying `ALTER DATABASE … SET search_path`, versus a
freshly-created shadow with the default path) produced DIFFERENT payloads and
hashes, causing mass false drift in the shadow-vs-target compare and shifting
routine stable-ids. Extraction now pins the deparse path so identical catalogs
hash identically regardless of session/database/role path settings, and rendered
DDL is fully schema-qualified.

The plan preamble now also pins `search_path` to `pg_catalog` at apply time so
rendered DDL resolves identically regardless of the applier role's defaults.

`ENGINE_VERSION` is bumped to `0.2.0` (hash-invalidating): plan artifacts,
snapshots, and baselines captured before this change must be regenerated.
