---
"@supabase/pg-delta": minor
---

Export `collectTableStats` and `TableStat` from the package root and `@supabase/pg-delta/proof` so callers can fingerprint relation contents without reimplementing the proof-loop SQL.
