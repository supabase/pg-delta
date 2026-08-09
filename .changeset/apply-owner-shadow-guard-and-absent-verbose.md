---
"@supabase/pg-delta": patch
---

`schema apply` now (1) fails closed when an explicit `--shadow`'s connection role differs from the export's stamped default owner — the shadow would otherwise load omitted-`OWNER TO` objects as its own role and plan spurious ownership drift — and (2) treats a directory with no manifest default-owner record as verbose, honoring every explicit `OWNER TO` in the files instead of synthesizing a target default and pruning owner edges to it (which silently dropped an explicit owner change when the target object was owned by a different role).
