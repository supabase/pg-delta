---
"@supabase/pg-delta": patch
---

prove: per-table autoSeed outcome reporting (seeded/skipped/failed) surfaced in the proof verdict. `provePlan({ autoSeed: true })` no longer swallows insert failures — each empty kept table now reports `seeded`, `skipped`, or `failed` on `ProofVerdict.seedOutcomes`. A `skipped` is either an expected class-23 integrity-constraint violation (the SQLSTATE as `reasonCode`) or the synthetic `no_row` code, meaning the `DEFAULT VALUES` insert resolved but a trigger/rule left the table empty (persistence is confirmed with an existence probe, since the command tag / rowCount can lie). Anything else is a `failed` with its message, so a genuinely-unseedable table is no longer confused with one that failed for a reason nobody saw.
