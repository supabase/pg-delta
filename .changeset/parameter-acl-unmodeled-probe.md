---
"@supabase/pg-delta": patch
---

`extract()` now detects `pg_parameter_acl` (PG 15+, backs `GRANT SET ON PARAMETER` / `GRANT ALTER SYSTEM ON PARAMETER`) and surfaces it as an `unmodeled_kind` diagnostic instead of silently missing it. The probe is version-gated and stays a clean no-op on PG 14.
