---
"@supabase/pg-delta": minor
---

Export `pruneStaleSqlFiles`, `renderApplyScript`, and `probeUnmodeledIdentitiesPinned` from the package root and `@supabase/pg-delta/frontends` so library consumers can prune stale schema files, render a dry-run apply script, and probe unmodeled drift without importing `src/cli/**` or unexported frontend modules. `pgdelta` already used them internally.

`pruneStaleSqlFiles` now resolves relative `keep`/`previouslyOwned` entries against `outRoot` (absolute entries are unchanged), so a consumer passing outRoot-relative paths cannot misread kept files as out-of-set — which under `pruneUnmanaged` would have deleted them.
