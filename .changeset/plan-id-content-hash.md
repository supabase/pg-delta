---
"@supabase/pg-delta": minor
---

Require `Plan.planId`, a SHA-256 content hash over the plan-bound approval ingredients (format/engine version, source/target fingerprints, accepted renames, the ordered action list, and profile/scope/policy). `plan()` stamps it; `parsePlan` and `apply()` refuse a missing or mismatching digest. Stale artifacts without `planId` must be re-planned — they are never silently upgraded.
