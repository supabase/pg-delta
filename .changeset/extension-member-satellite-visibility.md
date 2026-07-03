---
"@supabase/pg-delta-next": minor
---

Capture ACL / comment / security-label customizations layered on extension members.

Extension members (a contrib function, a pg_net function, an extension's tables/types/schema) were projected entirely out of the managed view — the member object AND its satellite facts. That correctly stops pg-delta from re-creating extension internals, but it also silently dropped USER state layered on those objects: e.g. Supabase's `GRANT EXECUTE ON FUNCTION net.http_get(...) TO anon, authenticated, service_role, …`. Such grants never appeared in a plan (or the Supabase baseline fixture), so a rebuilt database diverged from reality.

Extension members are now kept **reference-only**: the member object (and its structural descendants) is never itself created/dropped/altered — `CREATE EXTENSION` still owns its lifecycle — but its satellite customizations are diffed and emitted, ordered after `CREATE EXTENSION` (and before `DROP EXTENSION`):

- **ACLs** use pg_dump's `pg_init_privs` model: only grantees whose privileges differ from the extension's as-installed set (or `acldefault` when no init row was recorded) are emitted. A member that was never customized yields no ACL facts, so plain extensions stay churn-free (no redundant `GRANT`/`REVOKE` of the extension's own defaults).
- **Comments / security labels** on members are diffed as-is. (There is no init-privs equivalent to subtract, so an extension's own member comments are re-emitted after `CREATE EXTENSION` — idempotent, but present in the plan.)

Fully-revoked init grants (a grantee present at install but later removed entirely) are not yet emitted; no member in the corpus or the Supabase baseline exercises that, and the proof loop would surface it as drift.
