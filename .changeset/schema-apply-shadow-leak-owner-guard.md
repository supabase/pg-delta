---
"@supabase/pg-delta": patch
---

Fix `schema apply` leaking its co-located shadow database when the default-owner
guard rejects a divergent applier. The guard's `process.exit(2)` fired before the
`finally` that drops the throwaway shadow, so a `pgdelta_shadow_*` database was
left behind on the target's cluster. The shadow is now released (respecting
`--keep-shadow`) before the guard exits, and the same cleanup runs on the
apply-failure exit path.
