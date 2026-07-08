---
"@supabase/pg-delta": patch
---

Fix co-located `schema apply` when the profile declares a baseline that contains assumed-schema objects. The assumed-schema shadow seed now derives from the raw target BEFORE baseline subtraction, so platform objects captured in the baseline (e.g. `auth.users`) are still seeded into the throwaway shadow and a user declarative dir that references them loads cleanly. Previously the seed subtracted the baseline first and silently emptied itself, so the load could not converge. (The seed is the "what must exist for user SQL to elaborate" question; only the diff subtracts the baseline.)
