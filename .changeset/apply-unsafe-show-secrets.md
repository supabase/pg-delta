---
"@supabase/pg-delta-next": patch
---

Add `--unsafe-show-secrets` to `schema apply` (mirroring `plan` / `diff` / `snapshot` / `schema export`). When set, the shadow and target extracts skip secret redaction so real FDW / server / user-mapping credentials and subscription conninfo in the declarative SQL round-trip to the target verbatim — previously they were always redacted back to `__OPTION_*__` placeholders, so a trusted `schema export --unsafe-show-secrets` directory could not be applied. Off by default; the loud "Secret redaction is DISABLED" warning is printed when enabled.
