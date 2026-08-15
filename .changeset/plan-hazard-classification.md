---
"@supabase/pg-delta": minor
---

Export `actionHazards` / `classifyPlanHazards` with stable `HazardKind` codes derived from proof-verified action safety fields and coverage diagnostics. Policy (which hazards block which target) stays in the caller. Hazard kinds are not stored on `Plan`/`Action` and are not part of `planId`.
