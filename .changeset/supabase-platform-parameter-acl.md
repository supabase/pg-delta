---
"@supabase/pg-delta": patch
---

The supabase profile now drops the platform `log_min_messages` parameter ACL grants (`supabase_admin` SET/ALTER SYSTEM, `supabase_realtime_admin` SET) from `unmodeled_kind` coverage. User parameter ACLs are still reported. Raw extract is unchanged.
