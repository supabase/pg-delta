---
"@supabase/pg-delta-next": patch
---

fix(pg-delta-next): export redaction manifest, ADP raw-load warning on all paths, collision-proof formatter placeholder

- `schema export` now writes a `.pgdelta-export.json` manifest recording its
  redaction mode, and `schema apply --dir` re-extracts the shadow with that mode.
  A `schema export --unsafe-show-secrets` directory then round-trips its real
  FDW/user-mapping/subscription credentials to the target without the operator
  re-passing `--unsafe-show-secrets` (and a redacted export is not silently
  applied unredacted). The flag remains the fallback for manifest-less
  directories. The manifest is a `.json` sidecar, so the SQL loader and export
  pruner (both `.sql`-only) ignore it (#3505088638).
- The ADP raw-load caveat (an `ALTER DEFAULT PRIVILEGES` may be deferred past
  objects created in the same load) is now surfaced on EVERY raw-load path —
  `--no-reorder` and a missing pg-topo peer, not only when diagnostics disabled
  the reorder assist (#3505088640).
- The SQL formatter's protected-segment placeholder now uses a sentinel prefix
  guaranteed absent from the input, so original SQL that literally contains the
  placeholder token (e.g. an identifier `"__PGDELTA_PLACEHOLDER_0__"`) is no
  longer clobbered by the restore step (#3505088644).
