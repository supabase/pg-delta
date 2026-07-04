---
"@supabase/pg-delta-next": patch
---

Fix objects created with a built-in PUBLIC default revoked never converging. PostgreSQL grants a default privilege to PUBLIC automatically on `CREATE` (USAGE on types/domains/languages, EXECUTE on functions/procedures/aggregates); when the desired state has that default revoked, extraction now models the absence as an empty PUBLIC ACL entry so the plan emits a `REVOKE ALL … FROM PUBLIC` that clears the create-time default. Previously the revoked default was dropped during extraction (ACLs coalesced through `acldefault()`), so a freshly-created object kept the default privilege and drifted. The "kind has a PUBLIC default" test is derived from `acldefault()` itself, so it stays correct across object kinds and PostgreSQL versions.
