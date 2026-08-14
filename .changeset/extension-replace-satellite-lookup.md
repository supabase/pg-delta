---
"@supabase/pg-delta": patch
---

Replace the per-replace scan over the full extension-member closure in the
satellite-replay loop with an inverted extension → members index plus an
extension kind guard. Emission order and rendered SQL are unchanged; plans with
wide replace sets on extension-heavy schemas (PostGIS, TimescaleDB) no longer
pay O(replaced facts × total extension members), and extension-free plans skip
building the closure entirely.
