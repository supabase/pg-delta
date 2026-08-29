---
"@supabase/pg-delta": minor
---

Align the supabase profile's user-policy surfaces with the platform's `supautils.policy_grants` (adds `realtime.subscription`, `storage.buckets_analytics`, `storage.s3_multipart_uploads`, `storage.s3_multipart_uploads_parts`) and keep `COMMENT ON POLICY` on those surfaces managed, so user policy comments survive diffs, exports, and DB forks instead of being dropped by the system-schema satellite exclude. The policy DSL's `target` predicate gains a `table` sub-field to scope satellite rules to sub-entity targets. `auth.*` surfaces and `storage.prefixes` are deliberately deferred (pending an Auth-team decision and the next base-image sync, respectively).
