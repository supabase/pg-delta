---
"@supabase/pg-delta-next": patch
---

fix(pg-delta-next): preserve object ownership across a replace (drop + recreate)

When an object is REPLACED (dropped and recreated — e.g. a function whose body
changed, which pg-delta-next models as a replace), the recreate re-owns it as the
applying role. The owner edge was re-emitted only from owner link/unlink deltas,
and a replaced fact's owner is UNCHANGED source→target (no delta), so no
`ALTER … OWNER TO` was emitted — the object silently changed owner to whoever ran
the migration (and lost its owner-derived ACL). The emitter now re-establishes the
owner edge for every replaced fact (and every descendant a replace recreated),
mirroring how the replace loop already recreates child ACL facts. Surfaced by the
Supabase baseline (`auth.uid()`/`role()`/`email()`, owned by `supabase_auth_admin`,
reverted to the applier after a body change).
