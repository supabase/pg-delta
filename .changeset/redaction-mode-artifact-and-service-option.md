---
"@supabase/pg-delta-next": patch
---

fix(pg-delta-next): preserve postgres_fdw `service` option and carry unsafe redaction mode into apply/prove

- `service` is a documented libpq/postgres_fdw connection option naming a
  `pg_service.conf` entry — a reference, not a credential. It was being redacted
  to `service=__OPTION_SERVICE__`, which made service-name changes invisible to
  `diff` (both sides redact identically) and emitted the placeholder on
  export/plan-from-empty. It is now on the safe-option allowlist.
- `plan --unsafe-show-secrets` fingerprints over unredacted secret values, but
  `apply`/`prove` re-extracted the target with default redaction, so the
  placeholder-vs-real fingerprint mismatch made unsafe plan artifacts fail the
  gate unless `--force` was passed. The redaction mode is now stamped on the plan
  artifact (`redactSecrets`) and `apply`/`prove` re-extract with the same mode,
  so an unsafe plan applies/proves without `--force`. Direct library plans omit
  the field and fall back to the redacting default (no behavior change).
