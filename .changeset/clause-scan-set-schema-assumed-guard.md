---
"@supabase/pg-delta-next": patch
---

Three more review fixes:

- **Formatter — qualified clause arguments.** `findClausePositions` (the generic clause finder used by the trigger/subscription/FDW/language/index formatters) treated a keyword-like tail of a schema-qualified identifier as a new clause start, so `EXECUTE FUNCTION public.execute()` became `EXECUTE FUNCTION public.` + `EXECUTE()`, and FDW/language `HANDLER`/`VALIDATOR` functions named `public.handler` / `public.validator` were split. It now skips tokens preceded by `.`.
- **Reorder safety — `SET SCHEMA`.** `SET SCHEMA 'x'` is a documented alias for `SET search_path`; `schema apply` now treats it as a reorder barrier (falls back to raw loading) like `SET search_path` / `SET ROLE`.
- **Assumed-schema requirement guard.** The action-graph guard treated any id in an assumed schema as ambient, so a managed object depending on a NEW assumed-schema object absent from the target (e.g. `auth.extra`) planned through and only failed at apply against the missing relation. The exemption now applies only to objects genuinely external to the managed view (e.g. extension members), so such a dependency fails at plan time with a clear `missing requirement`. Existing assumed-schema objects present on the target are unaffected (satisfied via `source.has`).
