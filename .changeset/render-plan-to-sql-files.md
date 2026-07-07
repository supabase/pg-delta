---
"@supabase/pg-delta-next": minor
---

Add `render` CLI command: `pg-delta-next render --plan <plan.json> --out <base>.sql [--allow-drops]` reads a plan artifact and writes its SQL as one or more dbmate-friendly `.sql` files, splitting on the same segment boundaries `apply` uses at execution time. A single-segment plan writes `<base>.sql`; a multi-segment plan (e.g. containing a `nonTransactional` or `commitBoundaryAfter` action) writes `<base>_1.sql`, `<base>_2.sql`, … in execution order, with a leading `-- pg-delta: transaction=false` comment on non-transactional segment files. Refuses to render a plan containing `drop` actions unless `--allow-drops` is passed. Exits `3` (not an error) when the plan has no actions, so callers can distinguish "no changes" from a hard failure.
