---
"@supabase/pg-delta": patch
---

prove: per-table autoSeed outcome reporting (seeded/skipped/failed by SQLSTATE class) surfaced in the proof verdict. `provePlan({ autoSeed: true })` no longer swallows insert failures — each empty kept table now reports `seeded`, `skipped` (an expected class-23 integrity-constraint violation, with the SQLSTATE as `reasonCode`), or `failed` (any other error, with its message) on `ProofVerdict.seedOutcomes`, so a genuinely-unseedable table is no longer confused with one that failed for a reason nobody saw.
