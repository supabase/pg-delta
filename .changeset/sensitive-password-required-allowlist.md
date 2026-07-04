---
"@supabase/pg-delta-next": patch
---

Keep the non-secret `postgres_fdw` user-mapping option `password_required` unredacted. It was previously treated as a credential and replaced with `__OPTION_PASSWORD_REQUIRED__`, which made a security-relevant `password_required=false` setting invisible to `diff` (both sides redacted to the same placeholder) and emitted the placeholder on export / plan-from-empty. It is now allowlisted like the other documented `postgres_fdw` options.
