---
"@supabase/pg-delta": patch
---

The stable-id parser now accepts column-qualified ACL ids
(`acl:(table:...).grantee.column`), which the encoder produces for
column-level grants. Snapshots and baselines that contain column-level grants
now load correctly in `drift`/`prove` instead of failing with a
"trailing input" parse error.
