---
"@supabase/pg-delta-next": patch
---

fix(pg-delta-next): rebuild dependent event triggers when their backing function is replaced

Functions are modeled as a single opaque `def`, so any function change is planned as
a replace (drop + recreate). A surviving event trigger whose backing function is
replaced was not pulled into the replacement closure — the `eventTrigger` rule was
missing `rebuildable`, so the closure skipped it. The plan then emitted `DROP FUNCTION`
while the event trigger still depended on it, and apply failed with
`cannot drop function … because other objects depend on it`. The event trigger is now
dropped before the function and recreated after (matching table triggers). Surfaced by
the Supabase baseline, whose `extensions.grant_pg_net_access()` and five sibling
extension-access functions back standalone event triggers.
