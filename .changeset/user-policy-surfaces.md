---
"@supabase/pg-delta": minor
---

feat(pg-delta): keep user RLS policies on storage/realtime surfaces through the supabase filter

RLS policies on `storage.objects`, `storage.buckets`, and `realtime.messages` were marked reference-only by the managed-schema exclude (assumed schema + Rule 4) and silently dropped from diffs and declarative exports. The supabase profile now includes policies on those surfaces — the platform seeds none, so any policy present is user-authored. `auth` policies and other managed-schema tables stay excluded.
