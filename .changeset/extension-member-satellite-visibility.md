---
"@supabase/pg-delta-next": minor
---

Capture ACL / comment / security-label customizations layered on extension members.

Extension members (a contrib function, a pg_net function, an extension's tables/types/schema) were projected entirely out of the managed view — the member object AND its satellite facts. That correctly stops pg-delta from re-creating extension internals, but it also silently dropped USER state layered on those objects: e.g. Supabase's `GRANT EXECUTE ON FUNCTION net.http_get(...) TO anon, authenticated, service_role, …`. Such grants never appeared in a plan (or the Supabase baseline fixture), so a rebuilt database diverged from reality.

Extension members are now kept **reference-only**: the member object (and its structural descendants) is never itself created/dropped/altered — `CREATE EXTENSION` still owns its lifecycle — but its satellite customizations are diffed and emitted, ordered after `CREATE EXTENSION` (and before `DROP EXTENSION`):

- **ACLs** use pg_dump's `pg_init_privs` model (a FULL OUTER JOIN of the current vs as-installed grants, falling back to `acldefault` when no init row was recorded): only grantees whose privilege/grant-option set differs from install are emitted, so plain extensions stay churn-free. This covers added/upgraded grantees, grant-option-only changes, AND a grantee whose install grant was fully **revoked** — the latter as an empty-privileges marker that plans a `REVOKE ALL … FROM PUBLIC` (e.g. Supabase revokes the install-time `PUBLIC EXECUTE` on `net.http_get`/`http_post`; that revocation was silently lost before). Dropping a member ACL customization RESTORES the as-installed grant (carried on the fact as non-semantic `_initPrivs`) instead of a blind `REVOKE ALL` that would strip the extension's own grant.
- **Comments / security labels** on members are diffed as-is. (There is no init baseline to subtract, so an extension's own member comments are re-emitted after `CREATE EXTENSION` — idempotent, but present in the plan.)

The requirement guard exempts a consumed member only when its owning extension is actually produced by the plan or already on the target, and a member's closure stops at a schema root's children (a user object inside an extension-created schema diffs normally).
