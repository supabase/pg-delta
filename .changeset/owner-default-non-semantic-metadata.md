---
"@supabase/pg-delta-next": patch
---

Fix the owner-ACL elision metadata leaking into the diff/fingerprint. The owner's create-time default privilege set (added for the owner-revoked-ACL fix) was stored in the **hashed** ACL payload, so comparing against a snapshot taken before the field existed, or a live database of a different PG version (PG17 table ACLs include `MAINTAIN`), produced a spurious `.ownerDefault` set delta — `plan()` threw `kind 'acl' has no rule for attribute 'ownerDefault'` and `drift` reported metadata-only drift.

The canonical payload encoding now treats object keys prefixed with `_` as **non-semantic metadata**: excluded from the content hash (`hash.ts`) and from `diff()`. The owner-default set is carried as `_ownerDefault`, so it still drives elision but never joins the equality surface — no cross-version / snapshot diff deltas or fingerprint drift.
