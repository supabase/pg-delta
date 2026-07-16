---
"@supabase/pg-delta": patch
---

Fix role drop to no longer emit `DROP OWNED BY <role>` ahead of `DROP ROLE <role>`.
`DROP OWNED BY` swept up anything the role owned outside the managed/projected
view (objects the engine never extracted), silently destroying unmanaged data
when applying the plan. Managed grants, default ACLs, and owned objects are
already revoked/reassigned/dropped by their own plan actions before the role
drop runs, so a plain `DROP ROLE` succeeds when everything is managed, and now
Postgres fails loud ("role cannot be dropped because some objects depend on
it") instead of silently destroying data when unmanaged ownership remains.
