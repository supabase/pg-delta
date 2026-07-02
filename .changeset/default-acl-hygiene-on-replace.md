---
"@supabase/pg-delta-next": patch
---

fix(pg-delta-next): apply default-ACL hygiene to replaced objects, not just added ones

An object recreated by a replace (drop + recreate — e.g. a function whose body
changed) fires active `ALTER DEFAULT PRIVILEGES` exactly like a fresh create, so it
can acquire a grant the desired state does not have — even when the default
privilege itself is UNCHANGED between the two sides (on the source, the object
simply predated the ADP). The emitter's default-ACL hygiene pass (revoke
implicit ADP grants with no corresponding desired acl fact) only covered added
facts; it now also covers replaced facts and their replace-recreated descendants.
Surfaced by the Supabase baseline: the replaced `extensions.grant_pg_net_access()`
acquired a stale `postgres` grant from the image's pre-existing default privileges.
