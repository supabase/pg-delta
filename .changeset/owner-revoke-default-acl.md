---
"@supabase/pg-delta-next": patch
---

Fix planning / export from empty for an object whose **owner** intentionally revoked one of their own create-time default privileges (e.g. `REVOKE UPDATE ON t FROM <owner>`). The default-ACL compaction elided the owner's `REVOKE ALL` / `GRANT` group as if it were the built-in default, so the applied object kept PostgreSQL's full owner default (the revoke was lost) and the plan never converged.

The owner's create-time default privilege set is now captured from `acldefault()` at extract time (version-correct — PG17 added `MAINTAIN`) and carried on the owner ACL fact. Compaction elides the owner group only when the desired owner privileges exactly equal that default, and never strips the load-bearing leading `REVOKE` from a subset owner grant.
