---
"@supabase/pg-delta": patch
---

Three safety/reporting fixes:

- **Rendered migration files restore session settings.** `render` (both the
  multi-file `renderPlanFiles` and the single-file `renderPlanSql`) previously
  emitted the plan preamble (`search_path = pg_catalog`,
  `check_function_bodies = off`) as plain session-level `SET`s with no restore,
  so a reused runner session (sequential migration runners) silently inherited
  them. It now mirrors `apply()`: `SET LOCAL` inside transactional files (reverts
  at COMMIT) and plain `SET` + a trailing `RESET` for non-transactional
  files/scripts.
- **`prove` no longer over-claims data preservation.** After a passing proof,
  the "data preservation verified" line is now qualified with honest coverage
  when tables were only count-verified (schema changed) or not compared
  (recreated/dropped), naming the affected tables. `ok`/exit semantics are
  unchanged — reporting honesty only.
- **`DROP EXTENSION` is flagged destructive when it owns data.** A dropped
  extension that owns a data-bearing persisted member (table / materialized
  view) now carries `dataLoss: "destructive"`, derived from the member closure;
  an extension whose members are only functions/types stays non-destructive.
  Previously every extension drop defaulted to non-destructive because its
  members are projected out of the diff.
