---
"@supabase/pg-delta": patch
---

Canonicalize the grantor's own default-privilege self-entry at extraction so `pg_default_acl` rows round-trip. A row built by explicit grants to the owner (`{owner=arwdDxtm/owner, other=…}`) and one built purely from grants to other roles (`{other=…}`, no owner entry) are behaviorally identical — Postgres re-adds the owner's `acldefault` entry to every new object at creation time regardless of the stored row. Previously the extractor emitted a spurious `revoked_default` marker for the owner whenever it was absent from the stored ACL, so re-exporting a replayed database produced a spurious `alter default privileges … revoke all … from <owner>` self-revoke. The owner's own revoked-default marker is now suppressed (PUBLIC and other-role markers are unaffected; a partial owner self-reduction that differs from `acldefault` is still represented as a positive fact).
