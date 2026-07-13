---
"@supabase/pg-delta": patch
---

Move the SUSET-GUC (`pg_settings.context = 'superuser'`) probe used to strip a co-located-shadow seed's non-replayable `SET` clauses out of the `schema apply` CLI command and into `resolveProfile`, as `ResolvedProfile.susetGucs`. The probe is now gated on the applier actually being a non-superuser: a superuser applier seeds SUSET-proconfig routines instead of skipping them.
